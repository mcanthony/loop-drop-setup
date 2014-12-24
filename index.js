var ObservStruct = require('observ-struct')
var ObservNodeArray = require('./node-array.js')
var Event = require('geval')
var Observ = require('observ')
var watch = require('observ/watch')
var computed = require('observ/computed')
var getDirName = require('path').dirname
var getBaseName = require('path').basename
var join = require('path').join

var NO_TRANSACTION = {}

module.exports = Setup

function Setup(context){
  var controllerContext = Object.create(context)

  var node = ObservStruct({
    controllers: ObservNodeArray(controllerContext),
    chunks: ObservNodeArray(context),
    selectedChunkId: Observ()
  })

  node.selectedTriggerId = computed([node.selectedChunkId, node.chunks.controllerContextLookup], function(selectedChunkId, chunkLookup){
    var selectedChunk = chunkLookup[selectedChunkId]
    if (selectedChunk){
      var selectedSlotId = selectedChunk.selectedSlotId
      return selectedSlotId ? selectedChunkId + '#' + selectedSlotId : null
    } else {
      return null
    }
  })



  node.resolved = ObservStruct({
    controllers: node.controllers.resolved,
    chunks: node.chunks.resolved
  })

  controllerContext.chunkLookup = node.chunks.controllerContextLookup

  var removeListener = null
  var removeCloseListener = null
  var currentTransaction = NO_TRANSACTION
  var lastSavedValue = NO_TRANSACTION
  var loading = false

  var onLoad = null
  var onClose = null
  node.onLoad = Event(function(broadcast){
    onLoad = broadcast
  })
  node.onClose = Event(function(broadcast){
    onClose = broadcast
  })

  node.onRequestEditChunk = Event(function(broadcast){
    node.requestEditChunk = broadcast
  })

  node.onRequestCreateChunk = Event(function(broadcast){
    node.requestCreateChunk = broadcast
  })

  node.getNewChunkId = function(src){
    var lookup = node.chunks.controllerContextLookup()
    var base = getBaseName(src, '.json')
    var incr = 0
    var id = base

    while (lookup[id]){
      incr += 1
      id = base + ' ' + (incr + 1)
    }

    return id
  }

  node.file = null

  node(function(newValue){
    if (newValue && newValue !== currentTransaction && node.file){
      if (Object.keys(newValue).length > 0){
        lastSavedValue = JSON.stringify(newValue)
        node.file.set(lastSavedValue)
      }
    }
  })

  function release(){
    if (removeListener){
      removeListener()
      removeCloseListener()
      removeListener = null
      removeCloseListener = null
    }
  }

  node.load = function(src){
    release()
    if (src){
      loading = true
      node.file = context.project.getFile(src, onLoad)
      node.path = node.file.path
      removeListener = watch(node.file, update)
      removeCloseListener = node.file.onClose(onClose)
    }
  }

  node.rename = function(newFileName){
    if (node.file){
      var currentFileName = getBaseName(node.file.path)
      if (newFileName !== currentFileName){
        var directory = getDirName(node.file.path)
        var newPath = join(directory, newFileName)
        var src = context.project.relative(newPath)

        release()

        var file = context.project.getFile(src)
        file.set(node.file())
        node.file.delete()
        node.file = file
        node.path = node.file.path
        removeListener = watch(node.file, update)
        removeCloseListener = node.file.onClose(onClose)
      }
    }
  }

  node.grabInput = function(){
    var length = node.controllers.getLength()
    for (var i=0;i<length;i++){
      var controller = node.controllers.get(i)
      if (controller.grabInput){
        controller.grabInput()
      }
    }

    // now focus the selected chunk
    if (node.selectedChunkId){
      var chunkId = node.selectedChunkId()
      for (var i=0;i<length;i++){
        var controller = node.controllers.get(i)
        var chunkPositions = controller().chunkPositions || {}
        if (controller.grabInput && chunkPositions[chunkId]){
          controller.grabInput()
        }
      }
    }
  }

  node.destroy = function(){
    if (node.file){
      node.file.close()
      node.file = null
      node.set({})
    }
    release()
  }

  function update(data){
    if (data && data !== lastSavedValue){
      try {
        var obj = JSON.parse(data || '{}') || {}
        currentTransaction = obj || {}
        node.set(currentTransaction)
        currentTransaction = NO_TRANSACTION
      } catch (ex) {
        if (loading === true){
          node.set(null)
        }
      }
    }
    loading = false
  }

  return node
}