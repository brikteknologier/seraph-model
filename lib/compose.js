var transformComps = require('./transform-composed-nodes');
var getId = require('./get-id');

function addCodependant(model, comp) {
  var blackList = [];
  var self = this;
  this.on('afterSave', function(node) {
    if (!node[comp.name]) return;

    var nodes = node[comp.name];
    if (!Array.isArray(nodes)) nodes = [nodes];

    var toRemove = nodes.map(function(node) {
      return blackList.push(getId(self.db, node)) - 1;
    });
    
    process.nextTick(function() {
      blackList = blackList.slice(0, toRemove[0])
        .concat(blackList.slice(toRemove[0] + toRemove.length));
    });
  });
  model.on('afterSave', function(node) {
    if (~blackList.indexOf(getId(self.db, node))) return;
    if (!self.usingTimestamps) return;

    var cypher = [ "START end=node({end})",
                   "MATCH (end)<-[:`" + comp.rel + "`]-(root)",
                   "SET root." + self.updatedField + " = timestamp()" ].join(" ");
    self.db.query(cypher, { end: getId(self.db, node) }, function() {});
  });
}

module.exports = function compose(model, compositionName, relName, opts) {
  if (!opts) opts = {};
  if (typeof opts.orderBy == 'string') opts.orderBy = { property: opts.orderBy };

  this.compositions[compositionName] = {
    model: model,
    rel: relName || compositionName,
    name: compositionName,
    many: !!opts.many,
    orderBy: opts.orderBy,
    transient: !!opts.transient
  };

  if (opts.updatesTimestamp)
    addCodependant.call(this, model, this.compositions[compositionName]);
};

