var assert = require('assert');
var moment = require('moment');
var async = require('async');

module.exports = function(schema) {
  var transforms = [];
  
  function createTransform(type, argument, key) {
    return function schemaValidationStep(object, callback) {
      preparers[type](argument, object, key, function(err, transformedObject) {
        if (!err) return callback(null, transformedObject);
        else callback(new Error("Schema validation failed when parsing `" +
              key + "` = `" + object[key] + "`. Got message: " + err));
      });
    }
  }

  for (var key in schema) {
    var keySchema = schema[key];
    if (typeof keySchema == 'string' || typeof keySchema == 'function')
      keySchema = { type: keySchema };
    for (var schemaValidationType in keySchema) {
      if (!preparers[schemaValidationType])
        throw new Error("Invalid schema key on `" + key + "`: `" +
                                  schemaValidationType + "`");
      transforms.push(createTransform(schemaValidationType,
                                      keySchema[schemaValidationType], key));
    }
  }

  return function(object, callback) {
    function seed(cb) { cb(null, object) };
    async.waterfall([seed].concat(transforms), callback);
  };
};

var preparers = {
  type: function(type, object, key, callback) {
    var value = object[key];
    if (typeof type != 'string' && typeof type != 'function')
      return callback("Unrecognised `type` on schema: " + type);
    if (value == null) return callback(null, object);

    if (typeof type == 'string') type = type.toLowerCase();

    // special types with transforms
    if (type in typeTransforms) {
      try {
        value = typeTransforms[type](value);
      } catch (e) {
        return callback(e);
      }
    } else {
      if (typeof type == 'string' && typeof value != type) 
        return callback("Expected " + type + ", got " + typeof value);
      else if (typeof type == 'function' && !(value instanceof type))
        return callback("Expected an instance of `" + type + "`");
    }

    object[key] = value;
    callback(null, object);
  },

  default: function(defaultValue, object, key, callback) {
    if (object[key] == null) object[key] = defaultValue;
    callback(null, object);
  },

  trim: function(trim, object, key, callback) {
    if (object[key] == null || typeof object[key] != 'string' || !trim)
      return callback(null, object);
    
    object[key] = object[key].trim();    
    callback(null, object);
  },

  lowercase: function(lowercase, object, key, callback) {
    if (object[key] == null || typeof object[key] != 'string' || !lowercase)
      return callback(null, object);
    
    object[key] = object[key].toLowerCase();
    callback(null, object);
  },

  uppercase: function(uppercase, object, key, callback) {
    if (object[key] == null || typeof object[key] != 'string' || !uppercase)
      return callback(null, object);
    
    object[key] = object[key].toUpperCase();
    callback(null, object);
  },

  required: function(required, object, key, callback) {
    if (!required || object[key] != null) return callback(null, object);
    callback("Key `" + key + "` is required, but was not found");
  },

  match: function(regexp, object, key, callback) {
    if (object[key] == null) return callback(null, object);
    if (!regexp instanceof RegExp) regexp = new RegExp(regexp);
    if (regexp.test(object[key])) return callback(null, object);
    callback("Expected `" + key + "` to match " + regexp);
  },

  enum: function(enumValues, object, key, callback) {
    if (object[key] == null) return callback(null, object);
    if (!Array.isArray(enumValues))
      return callback("Unrecognised `enum` on schema: `" + enumValues +
                      "` expected an array.");
    if (~enumValues.indexOf(object[key])) return callback(null, object);
    callback("Expected `" + key + "` to be in [" + enumValues + "]");
  },

  min: function(min, object, key, callback) {
    if (object[key] == null || object[key] >= min) return callback(null, object);
    callback("Expected `" + key + "` to be >= `" + min + "`");
  },

  max: function(max, object, key, callback) {
    if (object[key] == null || object[key] <= max) return callback(null, object);
    callback("Expected `" + key + "` to be <= `" + max + "`");
  }
}

var typeTransforms = {}
typeTransforms['date'] = typeTransforms[Date] = function(value) {
  if (value instanceof Date) return value.getTime();
  var date = moment(value)._d;
  if (date.toString() != 'Invalid Date') return date.getTime();
  else throw "Expected date, got: " + date;
}

typeTransforms['boolean'] = typeTransforms[Boolean] = function(value) {
  return value == '0' ? false : !!value;
}

typeTransforms['array'] = typeTransforms[Array] = function(value) {
  if (Array.isArray(value)) return value;
  return [value];
}

typeTransforms['number'] = typeTransforms[Number] = function(value) {
  if (typeof value == 'number') return value;
  var parsedValue = parseInt(value, 10);
  if (isNaN(parsedValue))
    throw "Expected number, got " + value;
  else return parsedValue;
};

typeTransforms['string'] = typeTransforms[String] = function(value) {
  return value.toString();
}
