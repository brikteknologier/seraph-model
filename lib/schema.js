var assert = require('assert');
var moment = require('moment');

var preparers = {
  type: function(type, object, key, callback) {
    var value = object[key];
    if (typeof type != 'string' && typeof type != 'function')
      return callback("Unrecognised `type` on schema: " + type);
    if (value == null) return callback(null, object);

    if (typeof type == 'string') type = type.toLowerCase();

    // special types with transforms
    if (type in typeTransforms) value = typeTransforms[type](value);
    else {
      if (typeof type == 'string' && typeof value != type) 
        return callback("Expected " + type + ", got " + typeof value);
      else if (typeof type == 'function' && !(value instanceof type))
        return callback("Expected an instance of `" + type.toString + "`");
    }

    object[key] = value;
    callback(null, object);
  }
}

var typeTransforms = {}
typeTransforms['date'] = typeTransforms[Date] = function(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.getTime();

  var date = moment(value)._d;

  if (date.toString() != 'Invalid Date') return date.getTime();
  else throw new Error("Expected date, got: " + date);
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
    throw new Error("Expected number, got " + value);
  else return parsedValue;
}

var prepareDefault = function(defaultValue, fieldName, model){
  model.on('prepare', function(object, callback){
    if(object[fieldName] == null) object[fieldName] = defaultValue;
    return callback(null, object);
  });
};

var prepareString = function(option, fieldName, model){
  model.on('prepare', function(object, callback){
    if(object[fieldName]){
      if(option === 'trim') object[fieldName] = object[fieldName].trim();
      if(option === 'uppercase') object[fieldName] = object[fieldName].toUpperCase();
      if(option === 'lowercase') object[fieldName] = object[fieldName].toLowerCase();
    }
    return callback(null, object);
  });
};

var validateRequired = function(fieldName, model){
  model.on('validate', function(object, callback){
    if(object[fieldName] == null) return callback(new SeraphError(fieldName+ ' is a required field.'));
    else return callback();
  });
};

var validateMatch = function(regExp, fieldName, model){
  model.on('validate', function(object, callback){
    var value = object[fieldName];
    if(value === null && value === '') return callback();
    return regExp.test(value)
      ? callback()
      : callback(new SeraphError(fieldName + ' value does not match the required pattern'));
  });
};

var validateEnum = function(values, fieldName, model){
  model.on('validate', function(object, callback){
    var value = object[fieldName];
    if(value === undefined || values.indexOf(value) !== -1) return callback();
    else return callback(new SeraphError(fieldName + ' value is not in the required list'));
  });
};

var validateNumber = function(option, optionValue, fieldName, model){
  model.on('validate', function(object, callback){
    var value = object[fieldName];
    if(option === 'min'){
      if(value >= optionValue) return callback();
      else return callback(new SeraphError(fieldName + ': ' + value + ' is less than the minimum of ' + optionValue));
    }
    if(option === 'max'){
      if(value <= optionValue) return callback();
      else return callback(new SeraphError(fieldName + ': ' + value + ' is greater than the maximum of ' + optionValue));
    }
  });
};

// Need to use the new Neo4j2 label indexes for these to work
// var addIndex = function(fieldName, model){
//   // TODO: confirm what this does.
//   var setOldOnConflict = true;
//   model.addIndex(fieldName, setOldOnConflict);
// };

// var setUniqueIndex = function(fieldName, model){
//   // TODO: confirm what this does.
//   var setOldOnConflict = true;
//   model.setUniqueIndex(fieldName, setOldOnConflict);
// };


var setUniqueKey = function(fieldName, model){
  // TODO: confirm what this does.
  var setOldOnConflict = true;
  model.setUniqueKey(fieldName, setOldOnConflict);
};
