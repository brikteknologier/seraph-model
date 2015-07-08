var util = require('util');
var async = require('async');
var _ = require('underscore');
var moment = require('moment');
var createSchemaParser = require('./schema');

function Model(seraphDb, type) {
  var self = this;
  this.db = seraphDb;
  this.fields = [];
  this.compositions = {};
  this.upstreamCodependants = [];
  this.events = {
    compute: [],
    validate: [],
    beforeSave: [],
    afterSave: [],
    prepare: []
  };

  var allWhitelistedKeys = function() {
    return self.fields.concat(
      [ self.db.options.id ],
      _.keys(self.compositions),
      self.usingTimestamps ? [ self.createdField, self.updatedField ] : []
    );
  };

  this.on('prepare', function whitelist(obj, callback) {
    if (!Array.isArray(self.fields) || !self.fields.length) {
      callback(null, obj);
    } else {
      callback(null, _.pick(obj, allWhitelistedKeys()));
    }
  });

  this.on('prepare', function(object, callback) {
    if (!schemaParser) return callback(null, object);
    schemaParser(object, callback);
  });

  var schema, schemaParser;

  Object.defineProperty(this, 'type', {
    enumerable: true, configurable: false, 
    get: function() { return type },
    set: function(newType) {
      type = newType;
    }
  });

  Object.defineProperty(this, 'schema', {
    enumerable: true, configurable: false, 
    get: function() { return schema },
    set: function(newSchema) {
      schema = newSchema;
      if (schema) {
        this.keys = Object.keys(schema);
        schemaParser = createSchemaParser(schema)
      } else {
        this.keys = [];
        schemaParser = null;
      }
      return schema;
    }
  });

  if (type) this.type = type;
}

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

Model.prototype.addComputer = function(fields, computer) {
  this.on('prepare', function(obj, callback) {
    callback(null, _.omit(obj, fields));
  });
  this.on('compute', computer);
};

Model.prototype.useTimestamps = function(createdField, updatedField) {
  if (this.usingTimestamps) return;

  var self = this;
  this.createdField = createdField || 'created';
  this.updatedField = updatedField || 'updated';
  this.usingTimestamps = true;
};

Model.prototype.touch = function(node, callback) {
  if (!this.usingTimestamps) return;
  var self = this;
  var query = [
    "START node=node({id})",
    "SET node." + this.updatedField + " = timestamp()",
    "RETURN node." + this.updatedField + " AS updated"
  ].join(' ');
  this.db.query(query, { id: node[this.db.options.id] }, function(err, result) {
    if (err) return callback(err);
    node[self.updatedField] = result.updated;
    callback(null, node);
  });
};

Model.prototype.setUniqueKey = function(key, returnOldOnConflict, callback) {
  this.on('validate', function(obj, cb) {
    if (obj[key] == null) {
      cb(util.format("The `%s` key was not set, but is required to save " +
                     "this object", key));
    } else cb();
  });
  if (typeof returnOldOnConflict == 'function') {
    callback = returnOldOnConflict;
    returnOldOnConflict = false;
  }
  this.uniqueness = { key: key, returnOld: !!returnOldOnConflict };
  this.db.constraints.uniqueness.createIfNone(this.type, key, callback || function(err) {
    if (err) throw err;
  });
};


Model.prototype.save = require('./write').save;
Model.prototype.push = require('./write').pushComposition;
Model.prototype.saveComposition = require('./write').saveComposition;
Model.prototype.read = require('./read').read;
Model.prototype.readComposition = require('./read').readComposition;

Model.prototype.prepare = function(obj, cb) {
  this.triggerTransformEvent('prepare', obj, cb);
};

Model.prototype.validate = function(obj, cb) {
  this.triggerProgressionEvent('validate', obj, cb);
};

Model.prototype.compute = function(obj, cb) {
  if (Array.isArray(obj)) {
    async.map(obj, this.compute.bind(this), cb);
  } else {
    this.triggerTransformEvent('compute', obj, cb);
  }
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
  var self = this;
  var id = this.db._getId(idOrObj);
  this.db.readLabels(id, function(err, labels) {
    if (err) {
      if (err.neo4jException == 'NodeNotFoundException') return callback(null, false);
      else return callback(err);
    } 
    callback(null, !!~labels.indexOf(self.type));
  });
};

Model.prototype.findAll = function(opts, callback) {
  if (typeof opts == 'function') {
    callback = opts;
    opts = {};
  }
  this.read(null, opts, callback);
}

Model.prototype.query = function(query, params, opts, callback) {
  if (typeof params == 'function') {
    callback = params;
    params = {};
    opts = {};
  } else if (typeof opts == 'function') {
    callback = opts;
    opts = {};
  }

  opts.query = query;
  opts.params = params;

  this.read(null, opts, callback);
};

Model.prototype.where = function(predicate, opts, callback) {
  if (typeof opts == 'function') {
    callback = opts;
    opts = { any: false };
  }
  var self = this;

  opts.varName = opts.varName || 'node';

  var matchers = Object.keys(predicate).map(function(key) {
    if (predicate[key] instanceof RegExp) {
      predicate[key] = '(?i)' + predicate[key].source;
      return opts.varName + '.' + key + ' =~ {' + key + '}';
    }
    return opts.varName + '.' + key + ' = {' + key + '}';
  });

  var query = 'MATCH (' + opts.varName + ':' + this.type + ') ' +
              'WHERE ' + matchers.join(opts.any ? ' OR ' : ' AND ')

  this.query(query, predicate, opts, callback);
}

Model.prototype.compose = require('./compose');

module.exports = function createSeraphModel(db, type) {
  return new Model(db, type);
};
