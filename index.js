// Date and time tool
const moment = require('moment');

// HTML color names
var colors = require('color-name');

// Mumble client
const NoodleJS = require('noodle.js');

// OSC
const osc = require("osc");

// HTTP server with WebSocket support
const app = require('express')();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Every update to all clients contains the complete display state
var state = {}

function updateClients() {
  // For each channel, check if a field needs to be reset
  Object.keys(state).forEach((key) => {
    chan = state[key];

    // Call resets after 8 seconds
    if ((chan.call) && (chan.callLastTime < (moment() - 8000))) {
      chan.call = false;

      udpOsc.send({
        address: '/intercom/call',
        args: [{type: "s", value: key}, {type: "i", value: 0}]
      });
    }

    // Talk resets after one second
    if ((chan.talk) && (chan.talkLastTime < (moment() - 1000))) {
      chan.talk = false;

      udpOsc.send({
        address: '/intercom/talk',
        args: [{type: "s", value: key}, {type: "i", value: 0}]
      });
    }

    // Text reset after one second
    if ((chan.text) && (chan.textLastTime < (moment() - 1000))) {
      chan.text = false;

      udpOsc.send({
        address: '/intercom/text',
        args: [{type: "s", value: key}, {type: "i", value: 0}]
      });
    }
  });

  console.log(state);
  io.emit('update', state);
}

// Simply serve index.html when asked for /
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
  console.log('NEW  connection from "' + socket.conn.remoteAddress + '" (' +
    socket.conn.request.headers['user-agent'] + ')');

  // Send the current state to all connected clients
  updateClients();

  // Simply inform when a user disconnects
  socket.on('disconnect', (reason) => {
    console.log('LOST connection from "' + socket.conn.remoteAddress + '" (' +
      reason + ')');
  });
});

http.listen(8124, () => {
  console.log('HTTP listening on *:8124');
});

// Connect to Mumble server
const client = new NoodleJS({
  url: '127.0.0.1',
  name: 'Callboy'
});

// Create an osc.js UDP Port listening on port 57121.
var udpOsc = new osc.UDPPort({
  localAddress: '0.0.0.0',
  localPort: 57121,
  remoteAddress: '255.255.255.255',
  remotePort: 53000,
  broadcast: true,
  metadata: true
});

// Listen for incoming OSC messages.
udpOsc.on("message", function (oscMsg, timeTag, info) {
  // TODO: This is to handle CALLs made by wireless push buttons or the like
  console.log("udpOsc: An OSC message just arrived!", oscMsg);
  console.log("udpOsc: Remote info is: ", info);
});

udpOsc.on("error", function (error) {
  console.log("udpOsc: An error occurred: ", error.message);
});

udpOsc.on("ready", function () {
  console.log("udpOsc: Port ready :)");
});


// Open the socket.
udpOsc.open();

client.on('ready', info => {
  console.log('Connected to Mumble server:', info);

  console.log('===== Channels: =====\n', client.channels);
  console.log('===== Users: =====\n', client.users);
  console.log('=====');

  // Stay in the root channel but "Listen" to all Intercom channels
  client.switchChannel(0).then(() => {
    var voiceTarget = 10;
    for (var [key, value] of client.channels) {
      console.log(key + " = ", value.name);
      // TODO: We should be using RegEx for the channel names instead
      if (value.name.startsWith('Intercom')) {
        console.log('Requesting to listen to "' + value.name + '" and setup voiceTarget ' + voiceTarget);
        
        client.startListeningToChannel(key).then((msg) => {
          console.log('startListeningToChannel success', msg)
        });

        client.setupVoiceTarget(voiceTarget, [], key).then((msg) => {
          console.log('setupVoiceTarget success', msg)
        });

        // Create the state for that channel
        const chan = value.name[value.name.indexOf('Channel ') + 8];
        const chanColor = value.name.split('(')[1].split(')')[0].toLowerCase();
        state[chan] = {
          color: chanColor,
          call: false,
          callLastTime: moment(),
          talk: false,
          talkLastTime: moment(),
          text: false,
          textLastTime: moment(),
          voiceTarget: voiceTarget
        }

        voiceTarget += 1;
      }
    }

    console.log(state);

    // Update all clients now
    updateClients();

    // Send the chan and color info via OSC
    sendChanColorsToOSC();

    // Update all clients periodically
    setInterval(updateClients, 200);
  });
});

function sendChanColorsToOSC() {
  var args = [];
  for (var key of Object.keys(state).sort()) {
    const color = colors[state[key].color];
    args.push({type: "s", value: key});
    args.push({type: "i", value: color[0]});
    args.push({type: "i", value: color[1]});
    args.push({type: "i", value: color[2]});
  }
  udpOsc.send({
    address: '/intercom/chanColors',
    args: args
  });
}

client.on('voiceData', (voiceData) => {
  // Find the name of the user from its session id
  for (var [key, value] of client.users) {
    if (value.session === voiceData.sender) {
      voiceData.senderName = value.name;
      voiceData.senderChannel = value.channel.id;

      // Find the name of the channel the sending user is in
      for (var [key, value] of client.channels) {
        if (value.id === voiceData.senderChannel) {
          voiceData.senderChannelName = value.name;
          break;
        }
      }

      break;
    }
  }
  //console.debug('voiceData:', voiceData);

  if (voiceData.senderChannelName) {
    const chanName = voiceData.senderChannelName;
    if (!chanName.startsWith('Intercom')) {
      return;
    }

    // Send this packet at most every 200ms
    if (moment() > state[chanName[chanName.indexOf('Channel ') + 8]].talkLastTime + 200) {
      //sendColorToOSC(chanName[chanName.indexOf('Channel ') + 8]);
      udpOsc.send({
        address: '/intercom/talk',
        args: [{type: "s", value: chanName[chanName.indexOf('Channel ') + 8]}, {type: "i", value: 1}]
      });
    }

    state[chanName[chanName.indexOf('Channel ') + 8]].talk = true;
    state[chanName[chanName.indexOf('Channel ') + 8]].talkLastTime = moment();
  }
});

//client.on('error', error => {
//  console.warn('Mumble error :( :', error);
//  console.warn('Since reconnecting does not work with Noodle.JS, we quit :)');
//});

client.on('message', message => {
  console.log('===== Message: =====\n', message);
  console.log('=====');

  const chanName = message.channels.array()[0].name;
  if (!chanName.startsWith('Intercom')) {
    return;
  }
  if (message.content === 'C') {
    //sendColorToOSC(chanName[chanName.indexOf('Channel ') + 8]);
    state[chanName[chanName.indexOf('Channel ') + 8]].call = true;
    state[chanName[chanName.indexOf('Channel ') + 8]].callLastTime = moment();

    udpOsc.send({
      address: '/intercom/call',
      args: [{type: "s", value: chanName[chanName.indexOf('Channel ') + 8]}, {type: "i", value: 1}]
    });
    
    // TODO: Shout the file to the correct channel! whisperId / target bla bla
    console.log('CALL in channel "' + chanName + '". voiceTarget:' + state[chanName[chanName.indexOf('Channel ') + 8]].voiceTarget)
    client.voiceConnection.playFile('call.mp3', state[chanName[chanName.indexOf('Channel ') + 8]].voiceTarget);
  } else {
    //sendColorToOSC(chanName[chanName.indexOf('Channel ') + 8]);
    state[chanName[chanName.indexOf('Channel ') + 8]].text = true;
    state[chanName[chanName.indexOf('Channel ') + 8]].textLastTime = moment();

    udpOsc.send({
      address: '/intercom/text',
      args: [{type: "s", value: chanName[chanName.indexOf('Channel ') + 8]}, {type: "i", value: 1}]
    });
  }

  updateClients();
});

client.connect();
