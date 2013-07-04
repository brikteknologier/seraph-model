var util = require('util');
var async = require('async');
var _ = require('underscore');
var modelIndex = 'nodes';
var pluralize = require('inflection').pluralize;
var promise = require('augur');
var awaiter = require('collect').awaiter;
var resolve = async.parallel;
var moment = require('moment');

function Model(seraphDb, type) {
  var self = this;
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

  var nodeIndex, idIndex; 

  function removeIndex(index) {
    var indexInArray = self.indexes.indexOf(index); // I am so sorry
    if (indexInArray == -1) return;
    self.indexes.splice(indexInArray, 1);
  };

  function addDefaultIndexes() {
    removeIndex(nodeIndex);
    removeIndex(idIndex);
    
    self.addIndex(modelIndex, 'type', type);
    self.addIndex(modelIndex, type, function(obj, cb) {
      cb(null, self.db._getId(obj));
    });
  }

  Object.defineProperty(this, 'type', {
    configurable: false,
    enumerable: true,
    get: function() { return type },
    set: function(newType) {
      type = newType;
      addDefaultIndexes();
    }
  });

  if (type) this.type = type;
}

function _createIndexObject(indexName, key, val, conditional) {
  conditional = conditional || function(obj, cb) { cb(null, true); };
  var keyFn = typeof key == 'function' 
          ? key : function(obj, cb) { return cb(null, key) };
  var valFn = typeof val == 'function'
          ? val : function(obj, cb) { return cb(null, val) };
  var index = { index: indexName,
                key: keyFn,
                val: valFn,
                conditional: conditional };
  return index;
};

Model.prototype.useTimestamps = function(createdField, updatedField) {
  createdField = createdField || 'created';
  updatedField = updatedField || 'updated';

  this.on('prepare', function addCreatedUpdated(obj, callback) {
    if (!obj[createdField]) obj[createdField] = moment().unix();
    obj[updatedField] = moment().unix();
    callback(null, obj);
  });
};

Model.prototype.addIndex = function(indexName, key, val, conditional) {
  var index = _createIndexObject(indexName, key, val, conditional);
  this.indexes.push(index);
  return index;
};

Model.prototype.setUniqueIndex = function(indexName, key, val,
                                          conditional, returnOldOnConflict) {
  if (typeof conditional != 'function') {
    returnOldOnConflict = conditional;
    conditional = undefined;
  }
  var index = _createIndexObject(indexName, key, val, conditional);
  index.returnOldOnConflict = !!returnOldOnConflict;
  this.uniqueIndex = index;
  return index;
};

Model.prototype.setUniqueKey = function(key, returnOldOnConflict) {
  this.on('validate', function(obj, cb) {
    if (obj[key] == null) {
      cb(util.format("The `%s` key was not set, but is required to save " +
                     "this object", key));
    } else cb();
  });
  this.setUniqueIndex(pluralize(this.type), key, function(obj, cb) {
    cb(null, obj[key]);
  }, returnOldOnConflict);
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
      
      if (transformedObjects.length == 1 && !opts.many) {
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

// This is wrapped because we have to differentiate between the `save` and 
// `saveUnique` calls if there's a uniqueIndex. Only calls save, no comp logic.
function _callSave(db, object, callback) {
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

function _commit(db, object, callback) {
  var isNew = object[db.options.id] == null;
  if (!Object.keys(this.compositions).length) {
    var id = _callSave.call(this, db, object, callback);
    return isNew ? id : promise()(null, this.db._getId(object));
  }

  var self = this;
  var txn = db.isBatch ? db : db.batch();

  var compStripped = _.clone(object);
  Object.keys(this.compositions).forEach(function(comp) {
    delete compStripped[comp]
  });

  var awaitNodeAndCompositions = awaiter('node', 'comps');
  var rootNodePromise = _callSave.call(this, txn, compStripped, 
                                       awaitNodeAndCompositions('node'));

  if (!isNew) {
    rootNodePromise = promise()(null, this.db._getId(object));
    _deleteOldCompositionRels.call(self, txn, object);
  }

  _transformComps.call(self, object, {}, function(opts, object, i, cb) {
    var isNodeNew = !object[db.options.id];
    var nodePromise = _commit.call(opts.model, txn, object, cb);
    
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

  if (!db.isBatch) txn.commit();

  awaitNodeAndCompositions.then(function(err, results) {
    if (err) return callback(err);
    callback(null, _.extend(results.node, results.comps));
  });

  return rootNodePromise;
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
    if (!Array.isArray(results)) results = [results];

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

  var self = this;
  awaitNodeAndComps.then(function(err, result) {
    if (err) {
      // This may be because the root node is nonexistent (usually deleted),
      // but the error message does not contain enough information for
      // us to determine that accurately.  Check if the node exists,
      // and possibly adjust the error accordingly.
      self.exists(id, function(err2, exists) {
        if (err2 || exists) return callback(err);
        callback(null, false);
      });
    } else {
      callback(null, _.extend(result.node, result.comps));
    }
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

Model.prototype.compose = function(model, compositionName, relName, many) {
  this.compositions[compositionName] = {
    model: model,
    rel: relName || compositionName,
    name: compositionName,
    many: !!many
  };
};

module.exports = function createSeraphModel(db, type) {
  return new Model(db, type);
};
