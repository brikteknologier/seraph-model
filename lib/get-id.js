module.exports = function getId(db, node) {
  var id = typeof node == 'object' ? node[db.options.id] : node;
  id = parseInt(id, 10);
  return isNaN(id) ? null : id;
}
