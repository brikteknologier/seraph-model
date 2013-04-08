var util = require('util');
var async = require('async');
var _ = require('underscore');
var modelIndex = 'nodes';
var awaiter = require('collect').awaiter;

function Model(seraphDb, type) {
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

  var self = this;
  this.on('prepare', function whitelist(obj, callback) {
    if (!Array.isArray(self.fields) || !self.fields.length) {
      callback(null, obj);
    } else {
      callback(null, _.pick(obj, self.fields.concat([self.db.options.id])));
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
    var compKeys = Object.keys(self.compositions);
    async.map(compKeys, function(compKey, callback) {
      if (!object[compKey]) return callback();
      var compOpts = self.compositions[compKey];
      var comps = object[compKey];
      comps = Array.isArray(comps) ? comps : [comps];
      async.map(comps, _beforeCommit.bind(compOpts.model), function(err, comps) {
        if (err) callback(err);
        callback(null, comps.length == 1 ? comps[0] : comps);
      });
    }, function(err, comps) {
      if (err) return callback(err);
      comps.forEach(function(comp, i) {
        if (!comp) return;
        object[compKeys[i]] = comp;
      });
      callback(null, object);
    });
  });
};

function _commit(db, object, callback) {
  var self = this;
  var isNew = !object[db.options.id];
  var txn = db.isBatch ? db : db.batch();

  function index(cb) {
    isNew ? _indexObject(txn, self.indexes, rootNode, cb) : cb();
  };

  var compKeys = Object.keys(this.compositions);
  var comps = compKeys.reduce(function(comps, key) {
    if (!!object[key]) {
      comps[key] = object[key];
      delete object[key];
    }
    return comps;
  }, {});
  compKeys = Object.keys(comps);

  var awaitNodeAndCompositions = awaiter('node', 'comps');
  var rootNode = txn.save(object, awaitNodeAndCompositions('node'));
  
  var waitForValueResolution = awaiter.num(1);
  var didResolveIndex = waitForValueResolution();
  var resolveNode = function(fn) {
    waitForValueResolution.then(function() { fn(rootNode); });
  };
  
  index(function(err) {
    if (err) return callback(err);
    async.map(compKeys, function(compKey, callback) {
      var compOpts = self.compositions[compKey];
      var models = comps[compKey];
      models = Array.isArray(models) ? models : [models];

      async.map(models, function(model, cb) {
        var onResolve = waitForValueResolution();
        var resolveNode = _commit.call(compOpts.model, txn, model, cb);
        resolveNode(function(node) {
          txn.relate(rootNode, compOpts.rel, node);
          onResolve();
        });
      }, function(err, results) {
        if (err) return callback(err);
        console.log(results);
        callback(null, results.length == 1 ? results[0] : results);
      });
    }, awaitNodeAndCompositions('comps'));
    didResolveIndex();
  });

  if (!db.isBatch) {
    waitForValueResolution.then(function() { txn.commit() });
  }

  awaitNodeAndCompositions.then(function(err, results) {
    if (err) return callback(err);

    var node = results.node;
    results.comps.forEach(function(comp, i) {
      node[compKeys[i]] = comp;
    });

    callback(null, node);
  });

  return resolveNode;
};

function _afterCommit(object, callback) {
  this.triggerEvent('afterSave', object, callback);
}

Model.prototype.save = function(object, callback) {
  async.waterfall([
    _beforeCommit.bind(this, object),
    _commit.bind(this, this.db),
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
  callback(null, object);
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

Model.prototype.read = function(idOrObj, callback) {
  var id = this.db._getId(idOrObj);
  this.db.index.read(modelIndex, this.type, idOrObj, callback);
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
    rel: relName || compositionName
  };
};

module.exports = function createSeraphModel(db, type) {
  return new Model(db, type);
};
