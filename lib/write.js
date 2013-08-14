var transformComps = require('./transform-composed-nodes'),
    async = require('async'),
    _ = require('underscore'),
    awaiter = require('collect').awaiter,
    promise = require('augur')
    compositionRelationCypherList = require('./composition-relation-cypher-list')
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

function deleteOldCompositionRels(db, object) {
  var self = this;
  var compRels = compositionRelationCypherList(this.compositions);

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

function commit(db, object, callback) {
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
  var rootNodePromise = executeSave.call(this, txn, compStripped, 
                                       awaitNodeAndCompositions('node'));

  if (!isNew) {
    rootNodePromise = promise()(null, this.db._getId(object));
    deleteOldCompositionRels.call(self, txn, object);
  }

  transformComps.call(self, object, {}, function(opts, object, i, cb) {
    var isNodeNew = !object[db.options.id];
    var nodePromise = commit.call(opts.model, txn, object, cb);
    
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

function indexAll(db, presave, postsave, callback) {
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

function commitAndIndex(object, callback) {
  var self = this;
  commit.call(this, this.db, object, function(err, savedObject) {
    if (err) return callback(err);
    indexAll.call(self, self.db, object, savedObject, function(err) {
      if (err) return callback(err);
      callback(null, savedObject);
    });
  });
};

function afterCommit(object, callback) {
  var self = this;
  sortComps.call(this, object);
  this.triggerEvent('afterSave', object);
  transformComps.call(self, object, object, function(opts, object, i, cb) {
    afterCommit.call(opts.model, object, cb);
  }, function(err, comps) {
    self.compute(object, callback);
  });
}

module.exports = {
  save: function saveModel(object, callback) {
    async.waterfall([
      beforeCommit.bind(this, object),
      commitAndIndex.bind(this),
      afterCommit.bind(this)
    ], callback);
  },
  pushComposition: function pushComposition(root, compName, object, callback) {
    var comp = this.compositions[compName]
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
  indexObject: indexObject
};
