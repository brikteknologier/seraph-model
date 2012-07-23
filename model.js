function Model(seraphDb, type) {
  this.type = type;
  this.db = seraphDb;
}

Model.prototype.save = function(object, callback) {
  var self = this;
  this.db.save(object, function(err, saved) {
    if (err) return callback(err);

    self.db.index('node', saved, 'type', self.type, function(err) {
      if (err) return callback(err);

      callback(null, saved);
    });
  })
}