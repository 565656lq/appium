// Wrapper around Apple's Instruments app
//

var spawn = require('child_process').spawn,
    express = require('express');

var Instruments = function(server, app, udid, bootstrap, template) {
  this.server = server;
  this.app = app;
  this.udid = udid;
  this.bootstrap = bootstrap;
  this.template = template;
  this.curCommand = null;
  this.curCommandId = -1;
  this.commandCallbacks = [];
  this.resultHandler = this.defaultResultHandler;
  this.readyHandler = this.defaultReadyHandler;
  this.proc = null;
  this.extendServer();
};

Instruments.prototype.launch = function(cb, exitCb) {
  if (typeof cb !== "undefined") {
    this.readyHandler = cb;
  }
  var self = this;
  this.proc = this.spawnInstruments();
  this.proc.stdout.on('data', function(data) {
    self.outputStreamHandler(data);
  });
  this.proc.stderr.on('data', function(data) {
    self.errorStreamHandler(data);
  });

  var bye = function(code) {};
  if (typeof exitCb === "function") {
    bye = exitCb;
  }

  this.proc.on('exit', function(code) {
    console.log("Instruments exited with code " + code);
    bye(code);
  });
};

Instruments.prototype.shutdown = function(cb) {
  this.proc.kill();
  if (cb) {
    cb();
  }
};

Instruments.prototype.spawnInstruments = function() {
  var args = ["-t", this.template];
  if (this.udid) {
    args = args.concat(["-w", this.udid]);
  }
  args = args.concat([this.app]);
  args = args.concat(["-e", "UIASCRIPT", this.bootstrap]);
  args = args.concat(["-e", "UIARESULTSPATH", '/tmp']);
  return spawn("/usr/bin/instruments", args);
};

Instruments.prototype.sendCommand = function(cmd, cb) {
  if (this.curCommand) {
    cb("Command in progress");
  } else {
    this.curCommandId++;
    this.curCommand = cmd;
    this.commandCallbacks[this.curCommandId] = cb;
  }
};

Instruments.prototype.extendServer = function(err, cb) {
  var self = this;
  this.server.get('/instruments/next_command', function(req, res) {
    // add timing logic etc...
    // if ( should rate limit ) {
    //   res.send(404, "Not Found");
    // } else {
    console.log("instruments asking for command, it is " + self.curCommand);
    if (self.curCommand) {
      res.send(self.curCommandId+"|"+self.curCommand);
    } else {
      res.send(404, "Not Found");
    }
    // }
  });
  this.server.post('/instruments/send_result/:commandId', function(req, res) {
    var commandId = parseInt(req.params.commandId, 10);
    var result = req.body.result;
    if (typeof commandId != "undefined" && typeof result != "undefined") {
      if (!self.curCommand) {
        res.send(500, {error: "Not waiting for a command result"});
      } else if (commandId != self.curCommandId) {
        res.send(500, {error: 'Command ID ' + commandId + ' does not match ' + self.curCommandId});
      } else {
        if (typeof result === "object" && typeof result.result !== "undefined") {
          result = result.result;
        }
        self.curCommand = null;
        self.commandCallbacks[commandId](result);
        res.send({success: true});
      }
    } else {
      res.send(500, {error: 'Bad parameters sent'});
    }
  });
  this.server.post('/instruments/ready', function(req, res) {
    self.readyHandler();
    res.send({success: true});
  });
};

Instruments.prototype.setResultHandler = function(handler) {
  this.resultHandler = handler;
};

Instruments.prototype.defaultResultHandler = function(output) {
  console.log("[INST] " + output);
};

Instruments.prototype.defaultReadyHandler = function() {
  console.log("Instruments is ready and waiting!");
};

Instruments.prototype.outputStreamHandler = function(output) {
  var re = /(\n|^)\*+\n?/g;
  output = output.toString();
  output = output.replace(re, "");
  if (output !== "") {
    output = output.replace(/\n/m, "\n       ");
    this.resultHandler(output);
  }
};

Instruments.prototype.errorStreamHandler = function(output) {
  var re = /\n\*+/m;
  output = output.toString();
  var result = output.replace(re, "");
  console.log("Stderr: " + result);
};

module.exports = function(server, app, udid, bootstrap, template) {
  return new Instruments(server, app, udid, bootstrap, template);
};
