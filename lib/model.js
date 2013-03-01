var util = require('util');
var async = require('async');
var _ = require('underscore');
var modelIndex = 'nodes';

function Model(seraphDb, type) {
  this.type = type;
  this.db = seraphDb;
  this.validators = [];
  this.preparers = [];
  this.fields = [];

  var self = this;
  this.preparers.push(function whitelist(obj, callback) {
    if (!Array.isArray(self.fields) || !self.fields.length) {
      callback(null, obj);
    } else {
      callback(null, _.pick(obj, self.fields.concat([self.db.options.id])));
    }
  });
}

Model.prototype.save = function(object, callback) {
  var self = this;
  async.waterfall([
    this.prepare.bind(this, object),

    function validate(object, callback) {
      self.validate(object, function(err) {
        if (err) {
          callback(err);
        } else {
          callback(null, object);
        }
      })
    },

    this._unvalidatedSave.bind(this)
  ], callback);
}

Model.prototype._unvalidatedSave = function(object, callback) {
  var self = this;
  this.db.save(object, function(err, saved) {
    if (err) return callback(err);

    self.db.index(modelIndex, saved, 'type', self.type, function(err) {
      if (err) return callback(err);

      callback(null, saved);
    });
  })
}

Model.prototype.validate = function(object, callback) {
  if (!Array.isArray(this.validators) || !this.validators.length) {
    callback();
  } else {
    async.forEach(this.validators, function(validator, callback) {
      validator(object, callback);
    }, callback);
  }
}

Model.prototype.prepare = function(object, callback) {
  if (!Array.isArray(this.preparers) || !this.preparers.length) {
    callback(null, object);
  } else {
    var seed = function(cb) {
      cb(null, _.clone(object));
    };
    async.waterfall([seed].concat(this.preparers), callback);
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
