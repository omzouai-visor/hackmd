'use strict'
// history
// external modules
var LZString = require('lz-string')

// core
var config = require('./config')
var logger = require('./logger')
var response = require('./response')
var models = require('./models')
var LZString = require('lz-string')

var permissionTypes = ['freely', 'editable', 'limited', 'locked', 'protected', 'private']

// public
var History = {
  historyGet: historyGet,
  historyPost: historyPost,
  historyDelete: historyDelete,
  updateHistory: updateHistory
}

function getHistory (userid, callback) {
  models.Note.findAll({
    include: [{// Notice `include` takes an ARRAY
      model: models.User,
      as: 'owner'
    }]
  }).then(function (notes) {
    var hs = []
    for (var i = 0; i < notes.length; i++) {
      var note = notes[i]
      var id = LZString.compressToBase64(note.id)
      var time = note.lastchangeAt || note.savedAt
      if (time !== undefined) {
        time = time.getTime()
      }
      var text = note.title;
      var tags = [];
      try {
        tags = models.Note.parseNoteInfo(note.content).tags;
      } catch (e) {
        console.log(e);
        tags = [];
      }

      var owner = "N/A";
      if (note.owner !== null) {
        owner = note.owner.email;
      }

      if(note.permission === 'private' && note.ownerId !== userid) {

      } else {
        hs.push({
          id: id,
          time: time,
          created: note.createdAt.getTime(),
          text: text,
          tags: tags,
          owner: owner
        })
      }
    }
    callback(null, parseHistoryToObject(hs))
  })

  /* models.User.findOne({
    where: {
      id: userid
    }
  }).then(function (user) {
    if (!user) {
      return callback(null, null)
    }
    var history = {}
    if (user.history) {
      history = JSON.parse(user.history)
      // migrate LZString encoded note id to base64url encoded note id
      for (let i = 0, l = history.length; i < l; i++) {
        try {
          let id = LZString.decompressFromBase64(history[i].id)
          if (id && models.Note.checkNoteIdValid(id)) {
            history[i].id = models.Note.encodeNoteId(id)
          }
        } catch (err) {
          // most error here comes from LZString, ignore
          logger.error(err)
        }
      }
      history = parseHistoryToObject(history)
    }
    if (config.debug) {
      logger.info('read history success: ' + user.id)
    }
    return callback(null, history)
  }).catch(function (err) {
    logger.error('read history failed: ' + err)
    return callback(err, null)
  }) */
}

function setHistory (userid, history, callback) {
  models.User.update({
    history: JSON.stringify(parseHistoryToArray(history))
  }, {
    where: {
      id: userid
    }
  }).then(function (count) {
    return callback(null, count)
  }).catch(function (err) {
    logger.error('set history failed: ' + err)
    return callback(err, null)
  })
}

function updateHistory (userid, noteId, document, time) {
  if (userid && noteId && typeof document !== 'undefined') {
    getHistory(userid, function (err, history) {
      if (err || !history) return
      if (!history[noteId]) {
        history[noteId] = {}
      }
      var noteHistory = history[noteId]
      var noteInfo = models.Note.parseNoteInfo(document)
      noteHistory.id = noteId
      noteHistory.text = noteInfo.title
      noteHistory.time = time || Date.now()
      noteHistory.tags = noteInfo.tags
      setHistory(userid, history, function (err, count) {
        if (err) {
          logger.log(err)
        }
      })
    })
  }
}

function parseHistoryToArray (history) {
  var _history = []
  Object.keys(history).forEach(function (key) {
    var item = history[key]
    _history.push(item)
  })
  return _history
}

function parseHistoryToObject (history) {
  var _history = {}
  for (var i = 0, l = history.length; i < l; i++) {
    var item = history[i]
    _history[item.id] = item
  }
  return _history
}

function historyGet (req, res) {
  if (req.isAuthenticated()) {
    getHistory(req.user.id, function (err, history) {
      if (err) return response.errorInternalError(res)
      if (!history) return response.errorNotFound(res)
      res.send({
        history: parseHistoryToArray(history)
      })
    })
  } else {
    return response.errorForbidden(res)
  }
}

function historyPost (req, res) {
  if (req.isAuthenticated()) {
    var noteId = req.params.noteId
    if (!noteId) {
      if (typeof req.body['history'] === 'undefined') return response.errorBadRequest(res)
      if (config.debug) { logger.info('SERVER received history from [' + req.user.id + ']: ' + req.body.history) }
      try {
        var history = JSON.parse(req.body.history)
      } catch (err) {
        return response.errorBadRequest(res)
      }
      if (Array.isArray(history)) {
        setHistory(req.user.id, history, function (err, count) {
          if (err) return response.errorInternalError(res)
          res.end()
        })
      } else {
        return response.errorBadRequest(res)
      }
    } else {
      if (typeof req.body['pinned'] === 'undefined') return response.errorBadRequest(res)
      getHistory(req.user.id, function (err, history) {
        if (err) return response.errorInternalError(res)
        if (!history) return response.errorNotFound(res)
        if (!history[noteId]) return response.errorNotFound(res)
        if (req.body.pinned === 'true' || req.body.pinned === 'false') {
          history[noteId].pinned = (req.body.pinned === 'true')
          setHistory(req.user.id, history, function (err, count) {
            if (err) return response.errorInternalError(res)
            res.end()
          })
        } else {
          return response.errorBadRequest(res)
        }
      })
    }
  } else {
    return response.errorForbidden(res)
  }
}

function historyDelete (req, res) {
  if (req.isAuthenticated()) {
    var noteId = req.params.noteId
    if (!noteId) {
      setHistory(req.user.id, [], function (err, count) {
        if (err) return response.errorInternalError(res)
        res.end()
      })
    } else {
      getHistory(req.user.id, function (err, history) {
        if (err) return response.errorInternalError(res)
        if (!history) return response.errorNotFound(res)
        delete history[noteId]
        setHistory(req.user.id, history, function (err, count) {
          if (err) return response.errorInternalError(res)
          res.end()
        })
      })
    }
  } else {
    return response.errorForbidden(res)
  }
}

module.exports = History
