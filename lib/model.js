var util = require('util');
var async = require('async');
var _ = require('underscore');
var modelIndex = 'nodes';

function Model(seraphDb, type) {
  this.type = type;
  this.db = seraphDb;
  this.fields = [];
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

Model.prototype.save = function(object, callback) {
  var self = this;
  var isNew = !object[this.db.options.id];

  var index = function(obj, cb) {
    isNew ? self.triggerProgressionEvent('index', obj, cb) : cb(null, obj);
  };

  async.waterfall([
    this.triggerTransformEvent.bind(this, 'prepare', object),
    this.triggerProgressionEvent.bind(this, 'validate'),
    this.triggerEvent.bind(this, 'beforeSave'),
    this.db.save.bind(this.db),
    index,
    this.triggerEvent.bind(this, 'afterSave')
  ], callback);
}

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

module.exports = function createSeraphModel(db, type) {
  return new Model(db, type);
};
