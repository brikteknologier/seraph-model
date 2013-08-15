var util = require('util');
var async = require('async');
var _ = require('underscore');
var modelIndex = 'nodes';
var pluralize = require('inflection').pluralize;
var moment = require('moment');

function Model(seraphDb, type) {
  var self = this;
  this.db = seraphDb;
  this.modelNodeIndex = modelIndex;
  this.fields = [];
  this.indexes = [];
  this.compositions = {};
  this.events = {
    compute: [],
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

Model.prototype.addComputedField = function(field, computer) {
  this.on('prepare', function(obj, callback) {
    if (obj[field]) delete obj[field];
    callback(null, obj);
  });
  this.on('compute', function(obj, callback) {
    if (computer.length == 1) {
      obj[field] = computer(obj);
      callback(null, obj);
    } else {
      computer(obj, function(err, fieldVal) {
        if (err) return callback(err);
        obj[field] = fieldVal;
        callback(null, obj);
      });
    }
  });
};

Model.prototype.useTimestamps = function(createdField, updatedField) {
  if (this.usingTimestamps) return;

  var self = this;
  this.createdField = createdField || 'created';
  this.updatedField = updatedField || 'updated';
  this.usingTimestamps = true;

  this.on('prepare', function addCreatedUpdated(obj, callback) {
    if (!obj[self.createdField]) obj[self.createdField] = moment().unix();
    obj[self.updatedField] = moment().unix();
    callback(null, obj);
  });
};

Model.prototype.touch = function(node, callback) {
  if (!this.usingTimestamps) return;
  this.db.save(node, this.updatedField, moment().unix(), callback);
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


Model.prototype.save = require('./write').save;
Model.prototype.push = require('./write').pushComposition;
Model.prototype.read = require('./read').read;
Model.prototype.readComposition = require('./read').readComposition;

Model.prototype.prepare = function(obj, cb) {
  this.triggerTransformEvent('prepare', obj, cb);
};

Model.prototype.validate = function(obj, cb) {
  this.triggerProgressionEvent('validate', obj, cb);
};

Model.prototype.compute = function(obj, cb) {
  this.triggerTransformEvent('compute', obj, cb);
};

Model.prototype.index = function(obj, cb) {
  require('./write').indexObject(this.db, this.indexes, obj, cb);
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

Model.prototype.findAll = function(callback) {
  this.db.index.readAsList(modelIndex, 'type', this.type, callback);
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

Model.prototype.compose = require('./compose');

module.exports = function createSeraphModel(db, type) {
  return new Model(db, type);
};
