var prepareType = function(type, fieldName, model){
  model.on('prepare', function(object, callback){
    var value = object[fieldName];

    if(value != null){
      object[fieldName] = function(){
        switch (type) {

        // if the type is a date return a date version
        case 'date':
          if (value === null || value === '')
            return null;

          if (value instanceof Date)
            return value.getTime();

          var date;

          // support for timestamps
          if (value instanceof Number || 'number' === typeof value || String(value) === Number(value))
            date = new Date(Number(value));

          // support for date strings
          else if (value.toString)
            date = new Date(value.toString());

          if (date.toString() !== 'Invalid Date')
            return date.getTime();

          return new CastError('date', value);

        // if the type is a boolean return a boolean version
        case 'boolean':
          if (value === null) return value;
          if (value === '0') return false;
          return !!value;

        // if the type is an array return an array version
        case 'array':
          if (Array.isArray(value)) return value;
          return [value];

        // if the type is a number return a number version
        case 'number':
          if (!isNaN(value)){
            if (null === value) return value;
            if ('' === value) return null;
            if ('string' === typeof value) value = Number(value);
            if (value instanceof Number) return value;
            if ('number' === typeof value) return value;
            if (value.toString && !Array.isArray(value) &&
                value.toString() === Number(value)) {
              return new Number(value);
            }
          }
          return new CastError('number', value);

        // if the type is a string return a string version
        case 'string':
          if (value === null) return value;
          if ('undefined' !== typeof value && value.toString) return value.toString();
          return new CastError('string', value);
        }
      }();
    }


    return callback(null, object);
  });
};

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
