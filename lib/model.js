var util = require('util');
var async = require('async');
var _ = require('underscore');
var modelIndex = 'nodes';

function Model(seraphDb, type) {
  this.type = type;
  this.db = seraphDb;
  this.fields = [];
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

  this.on('index', function(object, callback) {
    self.db.index(modelIndex, object, 'type', self.type, function(err) {
      if (err) return callback(err);
      callback(null, object);
    });
  });

  this.on('index', function(object, callback) {
    self.db.index(modelIndex, object, self.type, self.db._getId(object),
      callback);
  });
}

Model.prototype.save = function(object, callback, overloadedSave) {
  var self = this;
  var isNew = !object[this.db.options.id];

  var index = function(obj, cb) {
    isNew ? self.triggerProgressionEvent('index', obj, cb) : cb(null, obj);
  };

  var save = overloadedSave || this.composeInclusiveSave.bind(this);

  async.waterfall([
    this.triggerTransformEvent.bind(this, 'prepare', object),
    this.triggerProgressionEvent.bind(this, 'validate'),
    this.triggerEvent.bind(this, 'beforeSave'),
    this.composeInclusiveSave.bind(this),
    index,
    this.triggerEvent.bind(this, 'afterSave')
  ], callback);
}

Model.prototype.composeInclusiveSave = function(obj, cb) {
  if (!Object.keys(this.compositions).length) return this.db.save(obj, cb);
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
  this.triggerProgressionEvent('index', obj, cb);
};

Model.prototype.on = function(event, action) {
  if (!this.events[event]) throw new Error("No such event - " + event);
  this.events[event].push(action);
};

Model.prototype.triggerEvent = function(event, object, callback) {
  if (this.events[event].length) {
    this.events[event].forEach(function(listener) {
      listener(object);
    });
  }
  callback(null, object);
};

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
    rel: relName
  };
};

module.exports = function createSeraphModel(db, type) {
  return new Model(db, type);
};
