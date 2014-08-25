var transformComps = require('./transform-composed-nodes'),
    async = require('async'),
    _ = require('underscore'),
    compositionRelationCypherList = require('./composition-relation-cypher-list'),
    sortComps = require('./sort-compositions');

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
    model: this,
    children: []
  };

  if (!allNodes) allNodes = graph.allNodes = [graph];

  for (var compName in this.compositions) {
    var comp = this.compositions[compName];
    if (!node[comp.name] || comp.transient) continue;
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

function getSetCreatedTimestampStatement(node) {
  var prop = node.name + '.' + node.model.createdField;
  return prop + '= CASE WHEN has(' + prop + ') THEN ' + prop + ' ELSE timestamp() END';
};

var compose = {
  // get the START statement of a write query
  // this will start with all the pre-existing nodes
  start: function (graph, opts, params) {
    var self = this;
    var savedNodes = graph.allNodes.filter(function(node) {
      return node.props[self.db.options.id] != null 
          && !(node.model.uniqueness && node.model.uniqueness.returnOld);
    });

    if (!savedNodes.length) return '';

    var statements = savedNodes.map(function(node) {
      params[node.name + 'id'] = self.db._getId(node.props);
      return node.name + '=node({' + node.name + 'id})';
    });

    return 'START ' + statements.join(',');
  },
  match: function (graph, opts, params) {
    // starting with  match is currently unsafe because if you want to change
    // the key of an object, the object you're saving will already have a different
    // key, and seraph-model has no reference to the old one. hopefully this code
    // can come back into use at some time, but as it is now it is not possible.
    return '';
    var self = this;
    var savedUniqueNodes = graph.allNodes.filter(function(node) {
      return node.props[self.db.options.id] != null 
          && node.model.uniqueness
          && !node.model.uniqueness.returnOld;
    });

    if (!savedUniqueNodes.length) return '';

    var statements = savedUniqueNodes.map(function(node) {
      var uniqueKey = node.model.uniqueness.key;
      params[node.name + 'key'] = node.props[uniqueKey];
      return '(' + node.name + ':' + node.model.type + ' {' + uniqueKey + ': {' + node.name + 'key}})';
    });

    return 'MATCH ' + statements.join(',');
  },
  merge: function (graph, opts, params) {
    var self = this;
    var savedUniqueNodes = graph.allNodes.filter(function(node) {
      return node.model.uniqueness
          && node.model.uniqueness.returnOld;
    });

    if (!savedUniqueNodes.length) return '';

    var statements = savedUniqueNodes.map(function(node) {
      var uniqueKey = node.model.uniqueness.key;
      params[node.name + 'key'] = node.props[uniqueKey];
      return 'MERGE (' + node.name + ':' + node.model.type + 
        ' {' + uniqueKey + ': {' + node.name + 'key}})';
    });

    return statements.join(' ');
  },
  // get the CREATE statement of a write query
  // this will create non-existant nodes
  create: function (graph, opts, params) {
    var self = this;
    var newNodes = graph.allNodes.filter(function(node) {
      return node.props[self.db.options.id] == null
          && !(node.model.uniqueness && node.model.uniqueness.returnOld);
    });

    if (!newNodes.length) return '';

    var statements = newNodes.map(function(node) {
      var label = node.model.type;
      return '(' + node.name + ':' + label + ')';
    });

    return 'CREATE ' + statements.join(',');
  },
  // get the SET statement of a write query
  // this will set the properties on all nodes
  set: function (graph, opts, params) {
    var self = this;
    var updatedNodes = graph.allNodes;
    if (opts.restrictToComp) {
      updatedNodes = graph.allNodes.filter(function(node) {
        return node.comp && node.comp.name == opts.restrictToComp;
      });
    }

    return 'SET ' + updatedNodes.reduce(function(statements, node) {
      // set props
      var props = node.props;
      if (props[self.db.options.id]) props = _.omit(props, self.db.options.id);
      params[node.name] = props;
      statements.push(node.name + '={' + node.name + '}');

      // set timestamps
      if (!node.model.usingTimestamps) return statements;
      statements.push(getSetCreatedTimestampStatement(node));
      statements.push(node.name + '.' + node.model.updatedField + ' = timestamp()');

      return statements;
    }, []).join(',');
  },
  // get the CREATE UNIQUE statement of a write query
  // this will create the required relationships
  createUnique: function (graph, opts, params) {
    if (graph.children.length == 0) return '';

    function getRels(node) {
      var rels = [];
      node.children.forEach(function(childNode) {
        rels.push(node.name + '-[:' + childNode.comp.rel + ']->' + childNode.name);
        rels.push.apply(rels, getRels(childNode));
      });
      return rels;
    }
    
    return 'CREATE UNIQUE ' + getRels(graph).join(',');
  },
  // creates a WITH clause that carries over all of the the current relevant
  // variables
  continuation: function (graph) {
    return 'WITH ' + _.pluck(graph.allNodes, 'name').join(',');
  },
  stripRedundantCompositions: function (graph, opts) {
    if (_.isEmpty(this.compositions) || opts.keepRedundancy) return '';
    var compositions = opts.restrictToComp
                        ? [ this.compositions[opts.restrictToComp] ]
                        : _.values(this.compositions);
    compositions = _.reject(compositions, function(comp) { return comp.transient });
    if (compositions.length == 0) return '';
    var compRels = compositionRelationCypherList(compositions);
    return [
      compose.continuation(graph),
      'OPTIONAL MATCH ' + graph.name + '-[rel:' + compRels + ']->target',
      'WHERE not (target IN [' + _.pluck(graph.allNodes, 'name').join(',') + '])',
      'DELETE rel'
    ].join(' ');
  },
  return: function (graph, opts) {
    return 'RETURN ' + _.pluck(graph.allNodes, 'name');
  }
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
      if (comp.transient) return cb();
      beforeCommit.call(comp.model, object, cb);
    }, callback);
  });
};

var COLLISION_EXC = 'UniqueConstraintViolationKernelException';
function cypherCommit(node, opts, callback) {
  var graph = createNodeGraph.call(this, node);
  var self = this;
  var params = {};
  var start = compose.start.call(this, graph, opts, params);
  var match = compose.match.call(this, graph, opts, params);
  var merge = compose.merge.call(this, graph, opts, params);
  var create = compose.create.call(this, graph, opts, params);
  var rels = compose.createUnique.call(this, graph, opts, params);
  var set = compose.set.call(this, graph, opts, params);
  var deleteRedundancies = compose.stripRedundantCompositions.call(this, graph, opts);
  var finish = compose.return.call(this, graph, opts)

  var query = [
    start,
    match,
    merge,
    create,
    rels,
    set,
    opts.excludeComps ? '' : deleteRedundancies,
    finish 
  ].join(' ')

  this.db.query(query, params, function(err, result) {
    if (err) {
      if (err.neo4jCause && err.neo4jCause.exception == COLLISION_EXC)
        err.statusCode = 409;
      callback(err)
    }
    else callback(null, reassembleFromGraph.call(self, graph, result[0]));
  });
}

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

    if (opts.excludeComps) 
      object = _.omit(object, _.pluck(self.compositions, 'name'));

    async.waterfall([
      beforeCommit.bind(this, object),
      function (object, callback) {
        cypherCommit.call(self, object, opts, callback);
      },
      afterCommit.bind(this)
    ], callback);
  },
  saveComposition: function saveComposition(root, compName, objects, opts, callback) {
    var comp = this.compositions[compName]

    if (typeof opts == 'function') {
      callback = opts;
      opts = {};
    }

    opts.restrictToComp = compName;

    if (!comp) return callback(new Error("Invalid composition name - "+compName));
    if (!Array.isArray(objects)) objects = [objects];

    var rootId = this.db._getId(root);
    if (!rootId) return callback(new Error("Invalid root node - " + root));

    var self = this;
    var shell = {};
    shell[self.db.options.id] = rootId;
    shell[comp.name] = objects;

    async.waterfall([
      function runBeforeCommit(cb) {
        self.triggerEvent('beforeSave', shell);
        async.map(objects, beforeCommit.bind(comp.model), cb);
      },
      function runCommitAndIndex(objects, cb) {
        cypherCommit.call(self, shell, opts, cb);
      },
      function runAfterCommit(shell, cb) {
        var objects = shell[comp.name];
        if (!Array.isArray(objects)) objects = [objects];
        self.triggerEvent('afterSave', shell);
        async.map(objects, afterCommit.bind(comp.model), cb);
      }
    ], function(err, objects) {
      if (err) return callback(err);
      if (objects.length == 1 && !comp.many) objects = objects[0];
      callback(null, objects);
    });
  },
  pushComposition: function pushComposition(root, compName, object, callback) {
    module.exports.saveComposition.call(this, root, compName, object, 
        { keepRedundancy: true }, function(err, saved) {
      if (err) return callback(err);
      else if (!Array.isArray(object) && Array.isArray(saved)) callback(null, saved[0]);
      else callback(null, saved);
    });
  }
};
