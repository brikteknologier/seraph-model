function getMatchers(predicate, opts) {
  return Object.keys(predicate).map(function(key) {
    if (predicate[key] instanceof RegExp) {
      predicate[key] = '(?isu)' + predicate[key].source;

      return `${opts.varName}.${key} =~ {${opts.varName}_${key}}`;
    }

    if (Array.isArray(predicate[key])) {
      return `${opts.varName}.${key} in {${opts.varName}_${key}}`;
    }

    return `${opts.varName}.${key} = {${opts.varName}_${key}}`;
  });
}

function composeWhere(matchers, opts) {
  return `WHERE ${matchers.join(opts.any ? ' OR ' : ' AND ')}`;
}

function extendPredicate(predicate, matchCondition, relVarName) {
  if (!matchCondition) { return predicate; }
  
  const predicateExtension = Object.keys(matchCondition).reduce(function(obj, key) {
    obj[`${relVarName}_${key}`] = matchCondition[key];

    return obj;
  }, {});
  const extendedPredicate = Object.assign({}, predicate, predicateExtension);

  return extendedPredicate;
}

module.exports = {
  getMatchers: getMatchers,
  composeWhere: composeWhere,
  extendPredicate: extendPredicate
};
