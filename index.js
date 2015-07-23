var ObservStruct = require('observ-struct')
var NodeArray = require('observ-node-array')
var Observ = require('observ')
var watch = require('observ/watch')
var computed = require('observ/computed')
var Event = require('geval')
var getDirName = require('path').dirname
var getBaseName = require('path').basename
var join = require('path').join
var relative = require('path').relative

var map = require('observ-node-array/map')
var lookup = require('observ-node-array/lookup')
var merge = require('observ-node-array/merge')

var Property = require('audio-slot/property')
var YankSilence = require('./yank-silence')

module.exports = Setup

function Setup(parentContext){

  var context = Object.create(parentContext)
  var audioContext = context.audio


  var node = ObservStruct({
    controllers: NodeArray(context),
    chunks: NodeArray(context),
    selectedChunkId: Observ(),
    volume: Property(1),
    globalScale: Property({
      offset: 0, 
      notes: [0,2,4,5,7,9,11]
    })
  })

  node._type = 'LoopDropSetup'

  context.setup = node
  context.globalScale = node.globalScale

  // main output
  context.output = audioContext.createGain()
  node.output = YankSilence(audioContext, context.output)
  node.output.connect(parentContext.output)

  context.active = context.output.active

  watch(node.volume, function(value){
    node.output.gain.value = value
  })

  node.onTrigger = Event(function (b) {
    context.triggerEvent = b
  })

  node.onTrigger(function(event){
    node.output.trigger()
    var split = event.id.split('/')
    var chunk = context.chunkLookup.get(split[0])
    var slotId = split[1]
    if (chunk){
      if (event.event === 'start'){
        chunk.triggerOn(slotId, event.time)
      } else if (event.event === 'stop'){
        chunk.triggerOff(slotId, event.time)
      }
    }
  })

  node.resolveAvailableChunk = function(id){
    var base = id
    var lookup = context.chunkLookup()
    var incr = 0

    while (lookup[id]){
      incr += 1
      id = base + ' ' + (incr + 1)
    }

    return id
  }

  node.destroy = function(){
    node.chunks.destroy()
    node.controllers.destroy()
    context.paramLookup.destroy()
  }

  // maps and lookup
  node.controllers.resolved = map(node.controllers, resolve)
  node.chunks.resolved = map(node.chunks, resolve)
  node.chunks.lookup = lookup(node.chunks, function(x){
    var descriptor = get(x)
    return descriptor && descriptor.id || undefined
  })

  context.chunkLookup = lookup(node.chunks, function(x){ 
    if (x){
      var data = x.resolved ? x.resolved() : x()
      return data && data.id || undefined 
    }
  }, resolve, resolveInner)


  // extend param lookup
  var lookups = []
  if (context.paramLookup) {
    lookups.push(context.paramLookup)
  }

  lookups.push(
    lookup(node.chunks, function(x){
      if (x && x.onSchedule){
        return x.id()
      }
    }, resolve, resolveInner)
  )

  context.paramLookup = merge(lookups)
  node.context = context

  node.resolved = ObservStruct({
    selectedChunkId: node.selectedChunkId,
    controllers: node.controllers.resolved,
    chunks: node.chunks.resolved
  })

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

  node.updateChunkReferences = function(oldId, newId){
    node.controllers.forEach(function(controller){
      if (controller.chunkPositions && controller.chunkPositions()){
        var value = controller.chunkPositions()[oldId]
        if (value && controller.chunkPositions.put){
          controller.chunkPositions.delete(oldId)
          controller.chunkPositions.put(newId, value)
        }
      }
    })

    updateParamReferences(node.chunks, oldId, newId)

    if (node.selectedChunkId() === oldId){
      node.selectedChunkId.set(newId)
    }
  }

  return node
}

function get(obs){
  return typeof obs == 'function' ? obs() : obs
}

function resolve(node){
  return node && node.resolved || node
}

function resolveInner(node){
  return node && node.node || node
}

function updateParamReferences(node, oldId, newId){
  var changed = false
  var result = JSON.stringify(node(), function(key, value){
    if (value && value.node === 'linkParam' && value.param === oldId){
      value.param = newId
      changed = true
    }
    return value
  })

  if (changed){
    node.set(JSON.parse(result))
  }
}