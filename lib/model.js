var util = require('util');
var async = require('async');
var _ = require('underscore');
var modelIndex = 'nodes';
var awaiter = require('collect').awaiter;

function Model(seraphDb, type) {
  var self = this;
  this.type = type;
  this.db = seraphDb;
  this.fields = [];
  this.indexes = [];
  this.compositions = {};
  this.events = {
    validate: [],
    beforeSave: [],
    afterSave: [],
    prepare: [],
    index: []
  };

  var allWhitelistedKeys = function() {
    return self.fields.concat([self.db.options.id], _.keys(self.compositions));
  };

  this.on('prepare', function whitelist(obj, callback) {
    if (!Array.isArray(self.fields) || !self.fields.length) {
      callback(null, obj);
    } else {
      callback(null, _.pick(obj, allWhitelistedKeys()));
    }
  });

  this.addIndex(modelIndex, 'type', this.type);
  this.addIndex(modelIndex, this.type, function(obj, cb) {
    cb(null, self.db._getId(obj));
  });
}

Model.prototype.addIndex = function(indexName, key, val, conditional) {
  conditional = conditional || function(obj, cb) { cb(null, true); };
  var keyFn = typeof key == 'function' 
          ? key : function(obj, cb) { return cb(null, key) };
  var valFn = typeof val == 'function'
          ? val : function(obj, cb) { return cb(null, val) };
  this.indexes.push({
    index: indexName,
    key: keyFn,
    val: valFn,
    conditional: conditional
  });
};

function _transformComps(source, target, iterator, callback) {
  var comps = this.compositions;
  var compKeys = Object.keys(comps);
  async.map(compKeys, function(compKey, callback) {
    var opts = comps[compKey];
    var objects = source[compKey];

    if (!objects) return callback();
    
    //make sure it's an array, we can unwrap it later if it wasn't
    objects = Array.isArray(objects) ? objects : [ objects ];

    async.map(objects, function(object, callback) {
      iterator(opts, object, objects.indexOf(object), callback);
    }, function(err, transformedObjects) {
      if (err) return callback(err);
      
      if (transformedObjects.length == 1) {
        transformedObjects = transformedObjects[0];
      }

      callback(null, transformedObjects);
    });
  }, function(err, transformedComps) {
    if (err) return callback(err);

    transformedComps.forEach(function(object, i) {
      if (!object) return;
      target[compKeys[i]] = object;
    });

    callback(null, target);
  });
};

function _indexObject(db, indexes, object, callback) {
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
function _beforeCommit(object, callback) {
  var self = this;
  async.waterfall([
    this.triggerTransformEvent.bind(this, 'prepare', object),
    this.triggerProgressionEvent.bind(this, 'validate'),
    this.triggerEvent.bind(this, 'beforeSave')
  ], function(err, object) {
    if (err) return callback(err);

    // run _beforeCommit on all composed objects as well.
    _transformComps.call(self, object, object, function(comp, object, i, cb) {
      _beforeCommit.call(comp.model, object, cb);
    }, callback);
  });
};

function _deleteOldCompositionRels(db, object) {
  var self = this;
  var compRels = _cypherComposedRelationList(this.compositions);

  if (!compRels) return;

  var exclude = _.chain(this.compositions)
    .keys()
    .reduce(function(list, comp) {
      if (!object[comp]) return list;
      if (!Array.isArray(object[comp])) {
        list.push(object[comp][self.db.options.id]);
      } else {
        object[comp].forEach(function(comp) {
          list.push(comp[self.db.options.id]);
        });
      }
      return list;
    }, [])
    .reject(function(id) { return id == null || id == '' })
    .value();
  
  var rootId = object[self.db.options.id];

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
      'WHERE NOT comp IN excluded',
      'DELETE rel'
    ].join(' '), {rootId: rootId, excludeIds: exclude});
  }
};

function _relateIfNotRelated(db, root, relName, target) {
  db.query([
    'START root=node({root}), target=node({target})',
    'WHERE NOT (root-[:`' + relName + '`]->target)',
    'CREATE root-[:`' + relName + '`]->target'
  ].join(' '), {
    root: root,
    target: target
  });
};

function _commit(db, object, callback) {
  if (!Object.keys(this.compositions).length) return db.save(object, callback);

  var self = this;
  var isNew = object[db.options.id] == null;
  var txn = db.isBatch ? db : db.batch();

  var compStripped = _.clone(object);
  Object.keys(this.compositions).forEach(function(comp) {
    delete compStripped[comp]
  });

  var awaitNodeAndCompositions = awaiter('node', 'comps');
  var rootNode = txn.save(compStripped, awaitNodeAndCompositions('node'));

  if (!isNew) {
    rootNode = this.db._getId(object);
    _deleteOldCompositionRels.call(self, txn, object);
  }

  _transformComps.call(self, object, {}, function(opts, object, i, cb) {
    var isNodeNew = !object[db.options.id];
    var node = _commit.call(opts.model, txn, object, cb);
    
    // if `node` or `root` are new we can guarantee no relationship exists and
    // create it
    if (isNodeNew || isNew) txn.relate(rootNode, opts.rel, node);
    // but if both existed we can't guarantee that. regardless, we can use a 
    // cypher query to only create a relationship if it did not already exist.
    // we can't do this in every case cypher params do not support intra-batch
    // references—but since we already know `node` and `root` are not new, we 
    // don't need to worry.
    else _relateIfNotRelated(txn, rootNode, opts.rel, node);
  }, awaitNodeAndCompositions('comps'));

  if (!db.isBatch) txn.commit();

  awaitNodeAndCompositions.then(function(err, results) {
    if (err) return callback(err);
    callback(null, _.extend(results.node, results.comps));
  });

  return rootNode;
};

function _indexAll(db, presave, postsave, callback) {
  var self = this;
  var txn = db.isBatch ? db : db.batch();

  var awaitIndexDataResolve = awaiter.num(1);
  var didResolveIndexData = awaitIndexDataResolve();
  var resolveIndex = awaitIndexDataResolve.then;

  (function(callback) {
    if (presave[db.options.id]) callback();
    else _indexObject(txn, self.indexes, postsave, callback);
  })(function(err) {
    if (err) return callback(err);
    
    _transformComps.call(self, presave, {}, function(opts, object, i, cb) {
      //create a callback for calling once the the related model has finished
      //resolving any values needed for saving (like asynchronous index values)
      var modelDidResolveIndexData = awaitIndexDataResolve();

      var postsaveObj = postsave[opts.name][i];
      var onResolve = _indexAll.call(opts.model, txn, presave, postsaveObj, cb);
      onResolve(modelDidResolveIndexData); 
    }, function() {});

    didResolveIndexData();
  })

  if (!db.isBatch) awaitIndexDataResolve.then(function() {
    txn.commit(callback);
  }); 

  return resolveIndex;
};

function _commitAndIndex(object, callback) {
  var self = this;
  _commit.call(this, this.db, object, function(err, savedObject) {
    if (err) return callback(err);
    _indexAll.call(self, self.db, object, savedObject, function(err) {
      if (err) return callback(err);
      callback(null, savedObject);
    });
  });
};

function _afterCommit(object, callback) {
  var self = this;
  this.triggerEvent('afterSave', object);
  _transformComps.call(self, object, {}, function(opts, object, i, cb) {
    _afterCommit.call(opts.model, object, cb);
  }, function() {
    callback(null, object);
  });
}

Model.prototype.save = function(object, callback) {
  async.waterfall([
    _beforeCommit.bind(this, object),
    _commitAndIndex.bind(this),
    _afterCommit.bind(this)
  ], callback);
}

// This will perform all of the save actions upon db. It 
Model.prototype.composeInclusiveSave = function(db, obj, cb) {
  if (!Object.keys(this.compositions).length) return db.save(obj, cb);
  var compKeys = Object.keys(this.compositions);
  var self = this;
  async.map(compKeys, function(compKey, callback) {
    if (!obj[compKey]) return callback(null, false);
    self.compositions[compKey].model.save(obj[compKey], callback);
    delete obj[compKey];
  }, function(err, comps) {
    if (err) return callback(err);
    self.db.save(obj, function(err, obj) {
      if (err) return callback(err);
      
    });
  });
};

Model.prototype.prepare = function(obj, cb) {
  this.triggerTransformEvent('prepare', obj, cb);
};

Model.prototype.validate = function(obj, cb) {
  this.triggerProgressionEvent('validate', obj, cb);
};

Model.prototype.index = function(obj, cb) {
  _indexObject(this.db, this.indexes, obj, cb);
};

Model.prototype.on = function(event, action) {
  if (!this.events[event]) throw new Error("No such event - " + event);
  this.events[event].push(action);
};

// Triggers a regular event. A regular event is just a function, we do not wait
// for it to call back before continuing. 
Model.prototype.triggerEvent = function(event, object, callback) {
  if (this.events[event].length) {
    this.events[event].forEach(function(listener) {
      listener(object);
    });
  }
  callback && callback(null, object);
};

// Triggers a progression event. A progression event is a function that takes a
// callback. We wait for that function to call the callback before continuing.
// The callback passed to `triggerProgressionEvent` will not be called until all 
// of the attached progression events have called their callbacks. 
Model.prototype.triggerProgressionEvent = function(event, object, callback) {
  if (!this.events[event].length) {
    callback(null, object);
  } else {
    async.forEach(this.events[event], function(listener, callback) {
      listener(object, callback);
    }, function(err) {
      callback(err, object);
    });
  }
}

// Triggers a transform event. A transform event is a function that takes a
// callback, and returns a transformed version of the object. `callback` is 
// called when all of the transform events have finished, and is passed the
// final transformed version of `object`.
Model.prototype.triggerTransformEvent = function(event, object, callback) {
  if (!this.events[event].length) {
    callback(null, object);
  } else {
    var seed = function(cb) {
      cb(null, _.clone(object));
    };
    async.waterfall([seed].concat(this.events[event]), callback);
  }
}

Model.prototype.exists = function(idOrObj, callback) {
  var id = this.db._getId(idOrObj);
  this.db.index.read(modelIndex, this.type, idOrObj, function(err, obj) {
    if (err) return callback(err);
    callback(null, !!obj);
  });
};

function _cypherComposedRelationList(comps) {
  return Object.keys(comps).map(function(compName) {
    var relName = comps[compName].rel;
    return '`' + relName + '`';
  }).join('|');
}

function _fetchAllCompositedNodes(db, root, comps, callback) {
  var compKeys = Object.keys(comps);
  if (!compKeys.length) return callback(null, {});

  var self = this;
  var compNamesForRels = {};
  compKeys.forEach(function(compName) {
    compNamesForRels[comps[compName].rel] = compName;
  });
  var rels = _cypherComposedRelationList(comps);

  var cypher = [
    "START root = node({root})",
    "MATCH root-[r:" + rels + "]->(node)",
    "RETURN type(r) as rel, collect(node) as nodes"
  ].join(" ");

  db.query(cypher, { root: this.db._getId(root) }, function(err, results) {
    if (err) return callback(err);

    var comps = {};
    results.forEach(function(result) {
      comps[compNamesForRels[result.rel]] = result.nodes;
    });

    var txn = self.db.batch()
    _transformComps.call(self, comps, comps, function(opts, obj, i, cb) {
      _fetchAllCompositedNodes.call(opts.model, txn, obj, 
          opts.model.compositions, function(err, comps) {
        if (err) return cb(err);
        cb(null, _.extend(obj, comps));
      });
    }, function(err, results) {
      if (err) return callback(err);
      callback(null, results);
    });

    if (txn.operations.length > 0) txn.commit();
  });
};

Model.prototype.read = function(idOrObj, callback) {
  var id = this.db._getId(idOrObj);

  if (!Object.keys(this.compositions)) {
    return this.db.index.read(modelIndex, this.type, id, callback);
  }

  var txn = this.db.batch();
  
  var awaitNodeAndComps = awaiter('node', 'comps');

  txn.index.read(modelIndex, this.type, id, awaitNodeAndComps('node'));
  _fetchAllCompositedNodes.call(this, txn, id, this.compositions,
      awaitNodeAndComps('comps'));

  txn.commit();

  awaitNodeAndComps.then(function(err, result) {
    if (err) return callback(err);
    callback(null, _.extend(result.node, result.comps));
  });
};

Model.prototype.readComposition = function(idOrObj, comp, callback) {
  var id = this.db._getId(idOrObj);
  var compObj = {};
  compObj[comp] = this.compositions[comp];
  
  if (!comp[0]) return callback(new Error("No such composition: " + comp));

  _fetchAllCompositedNodes.call(this, this.db, id, compObj, function(err, res) {
    if (err) return callback(err);
    callback(null, res[comp]);
  });
};

Model.prototype.findAll = function(callback) {
  this.db.index.read(modelIndex, 'type', this.type, callback);
}

Model.prototype.where = function(predicate, any, callback) {
  if (typeof any === 'function') {
    callback = any;
    any = false;
  }

  this.db.find(predicate, any, this.cypherStart(), callback);
}


Model.prototype.cypherStart = function() {
  return 'node:' + modelIndex + '(type = "' + this.type + '")';
}

Model.prototype.compose = function(model, compositionName, relName) {
  this.compositions[compositionName] = {
    model: model,
    rel: relName || compositionName,
    name: compositionName
  };
};

module.exports = function createSeraphModel(db, type) {
  return new Model(db, type);
};
