var transformComps = require('./transform-composed-nodes'),
    async = require('async'),
    _ = require('underscore'),
    awaiter = require('collect').awaiter,
    promise = require('augur'),
    compositionRelationCypherList = require('./composition-relation-cypher-list'),
    sortComps = require('./sort-compositions');

var resolve = async.parallel;

function indexObject(db, indexes, object, callback) {
  async.forEach(indexes, function(index, callback) {
    index.conditional(object, function(err, proceed) {
      if (err) return callback(err);
      else if (!proceed) return callback();
      async.parallel({
        key: index.key.bind(this, object),
        val: index.val.bind(this, object) 
      }, function(err, results) {
        if (err) return callback(err);
        if (db.isBatch) {
          db.index(index.index, object, results.key, results.val);
          callback();
        } else {
          db.index(index.index, object, results.key, results.val, callback);
        }
      });
    });
  }, function(err) {
    if (err) return callback(err);
    return callback(null, object);
  });
};

// prepare, validate, beforeSave
function beforeCommit(object, callback) {
  var self = this;
  async.waterfall([
    this.triggerTransformEvent.bind(this, 'prepare', object),
    this.triggerProgressionEvent.bind(this, 'validate'),
    this.triggerEvent.bind(this, 'beforeSave')
  ], function(err, object) {
    if (err) return callback(err);

    // run beforeCommit on all composed objects as well.
    transformComps.call(self, object, object, function(comp, object, i, cb) {
      beforeCommit.call(comp.model, object, cb);
    }, callback);
  });
};

function deleteOldCompositionRels(db, object, compositions) {
  var self = this;
  var compRels = compositionRelationCypherList(_.values(compositions));

  if (!compRels) return;

  var exclude = _.chain(compositions)
    .keys()
    .reduce(function(list, comp) {
      if (!object[comp]) return list;
      if (!Array.isArray(object[comp])) {
        list.push(self.db._getId(object[comp]));
      } else {
        object[comp].forEach(function(comp) {
          list.push(self.db._getId(comp));
        });
      }
      return list;
    }, [])
    .reject(function(id) { return id == null || id == '' })
    .value();
  
  var rootId = this.db._getId(object);

  if (!exclude.length) {
    db.query([
      'START root=node({rootId})',
      'MATCH root-[rel:' + compRels + ']->()',
      'DELETE rel'
    ].join(' '), {rootId: rootId});
  } else {
    db.query([
      'START root=node({rootId}), excluded=node({excludeIds})',
      'WITH root, collect(excluded) as excluded',
      'MATCH root-[rel:' + compRels + ']->comp',
      'WHERE NOT (comp IN excluded)',
      'DELETE rel'
    ].join(' '), {rootId: rootId, excludeIds: exclude});
  }
};

function _relateIfNotRelated(db, root, relName, target, callback) {
  db.query([
    'START root=node({root}), target=node({target})',
    'WHERE NOT (root-[:`' + relName + '`]->target)',
    'CREATE root-[:`' + relName + '`]->target'
  ].join(' '), {
    root: root,
    target: target
  }, callback || function(){});
};

// This is wrapped because we have to differentiate between the `save` and 
// `saveUnique` calls if there's a uniqueIndex. Only calls save, no comp logic.
function executeSave(db, object, callback) {
  var id = promise();
  var isNew = object[db.options.id] == null;
  if (!this.uniqueIndex || !isNew) id(null, db.save(object, callback));
  else {
    var index = this.uniqueIndex;
    index.conditional(object, function(err, goAhead) {
      if (err) callback(err);
      else if (!goAhead) id(null, db.save(object, callback));
      else async.parallel({
        key: index.key.bind(this, object),
        val: index.val.bind(this, object) 
      }, function(err, results) {
        if (err) callback(err);
        else id(null, db.saveUnique(object, index.index, results.key,
                            results.val, index.returnOldOnConflict, callback));
      });
    });
  }
  return id;
};

function stripComposedObjects(object) {
  var compStripped = _.clone(object);
  Object.keys(this.compositions).forEach(function(comp) {
    delete compStripped[comp]
  });
  return compStripped;
}

function makeName(names) {
  var count = -1, name;
  do {
    name = this.type + ++count;
  } while (~names.indexOf(name))
  names.push(name);
  return name;
}

function createNodeGraph(node, names, allNodes) {
  names = names || [];
  var root = stripComposedObjects.call(this, node);
  var graph = { 
    name: makeName.call(this, names),
    props: root,
    children: []
  };

  if (!allNodes) allNodes = graph.allNodes = [graph];

  for (var compName in this.compositions) {
    var comp = this.compositions[compName];
    if (!node[comp.name]) continue;
    var subnodes = node[comp.name];
    if (!Array.isArray(subnodes)) subnodes = [subnodes];
    for (var i in subnodes) {
      var subgraph = createNodeGraph.call(comp.model, subnodes[i], names, allNodes);
      subgraph.comp = comp;
      graph.children.push(subgraph);
      allNodes.push(subgraph);
    }
  }

  return graph;
}

function reassembleFromGraph(graph, data) {
  function _reassembleFromGraph(node, object) {
    node.children.forEach(function(child) {
      var node =  _reassembleFromGraph(child, data[child.name]);
      if (!object[child.comp.name]) 
        object[child.comp.name] = child.comp.many ? [node] : node;
      else if (!Array.isArray(object[child.comp.name]))
        object[child.comp.name] = [object[child.comp.name], node];
      else
        object[child.comp.name].push(node);
    });
    return object;
  }
  return _reassembleFromGraph(graph, data[graph.name] || data);
}

// get the START statement of a write query
// this will start with all the pre-existing nodes
function getStartFromGraph(graph, params) {
  var self = this;
  var savedNodes = graph.allNodes.filter(function(node) {
    return node.props[self.db.options.id] != null;
  });

  if (!savedNodes.length) return '';

  var statements = savedNodes.map(function(node) {
    params[node.name + 'id'] = self.db._getId(node.props);
    return node.name + '=node({' + node.name + 'id})';
  });

  return 'START ' + statements.join(',');
}

// get the CREATE statement of a write query
// this will create non-existant nodes
function getCreateFromGraph(graph, params) {
  var self = this;
  var newNodes = graph.allNodes.filter(function(node) {
    return node.props[self.db.options.id] == null;
  });

  if (!newNodes.length) return '';

  var statements = newNodes.map(function(node) {
    var label = node.comp ? node.comp.model.type : self.type;
    return '(' + node.name + ':' + label + ')';
  });

  return 'CREATE ' + statements.join(',');
}

// get the SET statement of a write query
// this will set the properties on all nodes
function getSetFromGraph(graph, params) {
  var self = this;
  return 'SET ' + graph.allNodes.map(function(node) {
    var props = node.props;
    if (props[self.db.options.id]) {
      props = _.clone(props);
      delete props[self.db.options.id];
    }
    params[node.name] = props;
    return node.name + '={' + node.name + '}';
  }).join(',');
}

// get the CREATE UNIQUE statement of a write query
// this will create the required relationships
function getCreateUniqueFromGraph(graph, params) {
  if (graph.children.length == 0) return '';
  function addChildren(root, children) {
    var rootChildRels = children.map(function(child) {
      return root + '-[:' + child.comp.rel + ']->(' + child.name + ')';
    });
    var allChildRels = [];
    children.forEach(function(child, i) {
      if (child.children.length == 0) {
        allChildRels.push(rootChildRels[i]);
      } else {
        var grandchildren = addChildren(rootChildRels[i], child.children);
        allChildRels = allChildRels.concat(grandchildren);
      }
    });
    return allChildRels;
  }
  
  var root = '(' + graph.name + ')';
  return 'CREATE UNIQUE ' + addChildren(root, graph.children).join(',');
}

// creates a WITH clause that carries over all of the the current relevant
// variables
function getContinuation(graph) {
  return 'WITH ' + _.pluck(graph.allNodes, 'name').join(',');
}

function getStripRedundantComps(graph) {
  if (this.compositions.length == 0) return '';
  var compRels = compositionRelationCypherList(_.values(this.compositions));
  return [
    getContinuation(graph),
    'OPTIONAL MATCH ' + graph.name + '-[rel:' + compRels + ']->target',
    'WHERE not (target IN [' + _.pluck(graph.allNodes, 'name').join(',') + '])',
    'DELETE rel'
  ].join(' ');
}

function getReturnFromGraph(graph) {
  return 'RETURN ' + _.pluck(graph.allNodes, 'name');
}

function cypherCommit(node, opts, callback) {
  var graph = createNodeGraph.call(this, node);
  var self = this;
  var params = {};
  var start = getStartFromGraph.call(this, graph, params);
  var create = getCreateFromGraph.call(this, graph, params);
  var rels = getCreateUniqueFromGraph.call(this, graph, params);
  var set = getSetFromGraph.call(this, graph, params);
  var deleteRedundancies = getStripRedundantComps.call(this, graph);
  var finish = getReturnFromGraph(graph)

  var query = [
    start,
    create,
    rels,
    set,
    opts.excludeComps ? '' : deleteRedundancies,
    finish 
  ].join('\n')

  this.db.query(query, params, function(err, result) {
    if (err) return callback(err);
    else return callback(null, reassembleFromGraph.call(self, graph, result[0]));
  });
}

function commit(db, object, opts, callback) {
  var isNew = object[db.options.id] == null;
  if (!Object.keys(this.compositions).length) {
    var id = executeSave.call(this, db, object, callback);
    return isNew ? id : promise()(null, this.db._getId(object));
  }

  var self = this;
  var txn = db.isBatch ? db : db.batch();

  var compStripped = _.clone(object);
  Object.keys(this.compositions).forEach(function(comp) {
    delete compStripped[comp]
  });

  var awaitNodeAndCompositions = awaiter('node', 'comps');
  var rootNodePromise;

  if (opts.restrictToComp) {
    rootNodePromise = promise()(null, this.db._getId(object));
    var comp = this.compositions[opts.restrictToComp];
    deleteOldCompositionRels.call(self, txn, object, [comp]);
    awaitNodeAndCompositions('node')(null, compStripped);
  } else {
    rootNodePromise = executeSave.call(this, txn, compStripped, 
                                       awaitNodeAndCompositions('node'));
    if (!isNew) {
      rootNodePromise = promise()(null, this.db._getId(object));
      if (!opts.excludeComps) {
        deleteOldCompositionRels.call(self, txn, object, this.compositions);
      }
    }
  }

  transformComps.call(self, object, {}, function(opts, object, i, cb) {
    var isNodeNew = !object[db.options.id];
    var nodePromise = commit.call(opts.model, txn, object, false, cb);
    
    resolve({
      node: nodePromise.then,
      rootNode: rootNodePromise.then
    }, function(err, res) {
      // if `node` or `root` are new we can guarantee no relationship exists and
      // create it
      if (isNodeNew || isNew) txn.relate(res.rootNode, opts.rel, res.node);
      // but if both existed we can't guarantee that. regardless, we can use a 
      // cypher query to only create a relationship if it did not already exist.
      // we can't do this in every case cypher params do not support intra-batch
      // references—but since we already know `node` and `root` are not new, we 
      // don't need to worry.
      else _relateIfNotRelated(txn, res.rootNode, opts.rel, res.node);
    });
  }, awaitNodeAndCompositions('comps'));

  if (!db.isBatch)  txn.commit();

  awaitNodeAndCompositions.then(function(err, results) {
    if (err) return callback(err);
    callback(null, _.extend(results.node, results.comps));
  });

  return rootNodePromise;
};

function indexAll(db, presave, postsave, opts, callback) {
  var self = this;
  var txn = db.isBatch ? db : db.batch();

  var awaitIndexDataResolve = awaiter.num(1);
  var didResolveIndexData = awaitIndexDataResolve();
  var resolveIndex = awaitIndexDataResolve.then;

  (function(callback) {
    if (presave[db.options.id]) callback();
    else indexObject(txn, self.indexes, postsave, callback);
  })(function(err) {
    if (err) return callback(err);
    
    transformComps.call(self, presave, {}, function(opts, object, i, cb) {
      //create a callback for calling once the the related model has finished
      //resolving any values needed for saving (like asynchronous index values)
      var modelDidResolveIndexData = awaitIndexDataResolve();

      var postsaveObj;
      if (Array.isArray(postsave[opts.name]))
        postsaveObj = postsave[opts.name][i]
      else postsaveObj = postsave[opts.name];

      var onResolve = indexAll.call(opts.model, txn, object, postsaveObj, cb);
      onResolve(modelDidResolveIndexData); 
    }, function() {});

    didResolveIndexData();
  })

  if (!db.isBatch) awaitIndexDataResolve.then(function() {
    txn.commit(callback);
  }); 

  return resolveIndex;
};

function commitAndIndex(object, opts, callback) {
  var self = this;
  var comps;
  if (opts.excludeComps) {
    var compNames = _.pluck(this.compositions, 'name');
    object = _.omit(object, compNames);
  }
  cypherCommit.call(this, object, opts, callback);
};

function afterCommit(object, callback) {
  var self = this;
  sortComps.call(this, object);
  this.triggerEvent('afterSave', object);
  transformComps.call(self, object, object, function(opts, object, i, cb) {
    afterCommit.call(opts.model, object, cb);
  }, function(err, comps) {
    if (err) return callback(err);
    self.compute(object, callback);
  });
}

module.exports = {
  save: function saveModel(object, excludeComps, callback) {
    var self = this;
    if (typeof excludeComps == 'function') {
      callback = excludeComps;
      excludeComps = false;
    }
    var opts = { excludeComps: excludeComps };
    async.waterfall([
      beforeCommit.bind(this, object),
      function (object, callback) {
        commitAndIndex.call(self, object, opts, callback);
      },
      afterCommit.bind(this)
    ], callback);
  },
  saveComposition: function saveComposition(root, compName, objects, callback) {
    var comp = this.compositions[compName]
    if (!comp) return callback(new Error("Invalid composition name - "+compName));
    if (!Array.isArray(objects)) objects = [objects];

    var rootId = this.db._getId(root);
    if (!rootId) return callback(new Error("Invalid root node - " + root));

    var self = this;

    async.waterfall([
      function runBeforeCommit(cb) {
        async.map(objects, beforeCommit.bind(comp.model), cb);
      },
      function runCommitAndIndex(objects, cb) {
        var shell = {};
        shell[self.db.options.id] = rootId;
        shell[comp.name] = objects;
        commitAndIndex.call(self, shell, { restrictToComp: comp.name }, cb);
      },
      function runAfterCommit(shell, cb) {
        var objects = shell[comp.name];
        if (!Array.isArray(objects)) objects = [objects];
        async.map(objects, afterCommit.bind(comp.model), cb);
      }
    ], function(err, objects) {
      if (err) return callback(err);
      if (objects.length == 1 && !comp.many) objects = objects[0];
      callback(null, objects);
    });
  },
  pushComposition: function pushComposition(root, compName, object, callback) {
    var comp = this.compositions[compName];
    if (!comp) return callback(new Error("Invalid composition name - "+compName));

    root = this.db._getId(root);

    if (!root) {
      return callback(new Error("You cannot push to an unsaved model"));
    }

    if (Array.isArray(object)) {
      var _push = module.exports.pushComposition.bind(this, root, compName);
      // Yeah, this is going to be mega slow. Prime candidate for optimisation.
      return async.mapSeries(object, _push, callback);
    }

    if (this.db._getId(object)) {
      var objectId = this.db._getId(object);
      _relateIfNotRelated(this.db, root, comp.rel, objectId, function(err) {
        if (err) callback(err);
        else callback(null, object);
      });
    // Not the most optimal implementation, we could shimmy on into the `_commit`
    // call somehow, but this is simpler for now. Uses 3 db calls per save rather
    // than 2. 
    } else {
      var self = this;
      comp.model.save(object, function(err, object) {
        if (err) return callback(err);
        var objectId = self.db._getId(object);
        _relateIfNotRelated(self.db, root, comp.rel, objectId, function(err) {
          if (err) callback(err);
          else callback(null, object);
        });
      });
    }
  },
  indexObject: indexObject,
};
