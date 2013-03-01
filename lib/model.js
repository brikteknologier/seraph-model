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
}

Model.prototype.save = function(object, callback) {
  var self = this;
  async.waterfall([
    this.triggerTransformEvent.bind(this, 'prepare', object),
    this.triggerProgressionEvent.bind(this, 'validate'),
    this.triggerEvent.bind(this, 'beforeSave'),
    this.db.save.bind(this.db),
    this.triggerProgressionEvent.bind(this, 'index'),
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
