var transformComps = require('./transform-composed-nodes');
var _ = require('underscore');

function addCodependant(model, comp) {
  var blackList = [];
  var self = this;
  this.on('afterSave', function(node) {
    if (!node[comp.name]) return;

    var nodes = node[comp.name];
    if (!Array.isArray(nodes)) nodes = [nodes];

    var toRemove = nodes.map(function(node) {
      return blackList.push(self.db._getId(node)) - 1;
    });
    process.nextTick(function() {
      blackList = blackList.slice(0, toRemove[0])
        .concat(blackList.slice(toRemove[0] + toRemove.length));
    });
  });
  model.on('afterSave', function(node) {
    if (~blackList.indexOf(self.db._getId(node))) return;
    if (!self.usingTimestamps) return;

    var dir = comp.direction;
    var rel = "-[:`" + comp.rel + "`]-";
    if (dir == 'out') rel = '<' + rel;
    else rel += '>';

    var cypher = [ "START end=node({end})",
                   "MATCH end"+ rel +"root",
                   "SET root." + self.updatedField + " = timestamp()" ].join(" ");
    self.db.queryRaw(cypher, { end: self.db._getId(node) }, function() {});
  });
}

module.exports = function compose(model, compositionName, relName, opts) {
  if (!opts) opts = {};
  if (typeof opts.orderBy == 'string') opts.orderBy = { property: opts.orderBy };
  if (!_.contains(['in', 'out'], opts.direction)) opts.direction = 'out';

  this.compositions[compositionName] = {
    model: model,
    rel: relName || compositionName,
    name: compositionName,
    many: !!opts.many,
    orderBy: opts.orderBy,
    transient: !!opts.transient,
    direction: opts.direction
  };

  if (opts.updatesTimestamp)
    addCodependant.call(this, model, this.compositions[compositionName]);
};
