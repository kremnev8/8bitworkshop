
import { Platform, BasePlatform } from "../common/baseplatform";
import { PLATFORMS, setKeyboardFromMap, AnimationTimer, RasterVideo, Keys, makeKeycodeMap, getMousePos, KeyFlags } from "../common/emu";
import { SampleAudio } from "../common/audio";
import { safe_extend } from "../common/util";
import { WaveformView, WaveformProvider, WaveformMeta } from "../ide/waveform";
import { setFrameRateUI, loadScript, current_project } from "../ide/ui";
import { HDLModuleRunner, HDLModuleTrace, HDLUnit, isLogicType } from "../common/hdl/hdltypes";
import { HDLModuleJS } from "../common/hdl/hdlruntime";
import { HDLModuleWASM } from "../common/hdl/hdlwasm";

declare var Split;

interface WaveformSignal extends WaveformMeta {
  name: string;
}

var VERILOG_PRESETS = [
  {id:'clock_divider.v', name:'Clock Divider'},
  {id:'binary_counter.v', name:'Binary Counter'},
  {id:'hvsync_generator.v', name:'Video Sync Generator'},
  {id:'test_hvsync.v', name:'Test Pattern'},
  {id:'7segment.v', name:'7-Segment Decoder'},
  {id:'digits10.v', name:'Bitmapped Digits'},
  {id:'scoreboard.v', name:'Scoreboard'},
  {id:'ball_absolute.v', name:'Ball Motion (absolute position)'},
  {id:'ball_slip_counter.v', name:'Ball Motion (slipping counter)'},
  {id:'ball_paddle.v', name:'Brick Smash Game'},
  {id:'chardisplay.v', name:'RAM Text Display'},
  {id:'switches.v', name:'Switch Inputs'},
  {id:'paddles.v', name:'Paddle Inputs'},
  {id:'sprite_bitmap.v', name:'Sprite Bitmaps'},
  {id:'sprite_renderer.v', name:'Sprite Rendering'},
  {id:'racing_game.v', name:'Racing Game'},
  {id:'sprite_rotation.v', name:'Sprite Rotation'},
  {id:'tank.v', name:'Tank Game'},
  {id:'sound_generator.v', name:'Sound Generator'},
  {id:'lfsr.v', name:'Linear Feedback Shift Register'},
  {id:'starfield.v', name:'Scrolling Starfield'},
  {id:'alu.v', name:'ALU'},
  {id:'cpu8.v', name:'Simple 8-Bit CPU'},
  {id:'racing_game_cpu.v', name:'Racing Game with CPU'},
  {id:'framebuffer.v', name:'Frame Buffer'},
  {id:'tile_renderer.v', name:'Tile Renderer'},
  {id:'sprite_scanline_renderer.v', name:'Sprite Scanline Renderer'},
  {id:'cpu16.v', name:'16-Bit CPU'},
  {id:'cpu_platform.v', name:'CPU Platform'},
  {id:'test2.asm', name:'16-bit ASM Game'},
  {id:'cpu6502.v', name:'6502 CPU'},
];

var VERILOG_KEYCODE_MAP = makeKeycodeMap([
  [Keys.LEFT,  0, 0x1],
  [Keys.RIGHT, 0, 0x2],
  [Keys.UP,    0, 0x4],
  [Keys.DOWN,  0, 0x8],
  [Keys.A,     0, 0x10],
  [Keys.B,     0, 0x20],
  [Keys.P2_LEFT,  1, 0x1],
  [Keys.P2_RIGHT, 1, 0x2],
  [Keys.P2_UP,    1, 0x4],
  [Keys.P2_DOWN,  1, 0x8],
  [Keys.P2_A,     1, 0x10],
  [Keys.P2_B,     1, 0x20],
  [Keys.START,     2, 0x1],
  [Keys.P2_START,  2, 0x2],
  [Keys.SELECT,    2, 0x4],
  [Keys.P2_SELECT, 2, 0x8],
  [Keys.VK_7, 2, 0x10],
]);

const TRACE_BUFFER_DWORDS = 0x40000;

const CYCLES_PER_FILL = 20;

// PLATFORM

var VerilogPlatform = function(mainElement, options) {
  this.__proto__ = new (BasePlatform as any)();
  
  var video : RasterVideo;
  var audio;
  var poller;
  var useAudio = false;
  var usePaddles = false;
  var videoWidth  = 292;
  var videoHeight = 256;
  var maxVideoLines = 262+40; // vertical hold
  var idata : Uint32Array;
  var timer : AnimationTimer;
  var timerCallback;
  var top : HDLModuleRunner;
  var cyclesPerFrame = (256+23+7+23)*262; // 4857480/60 Hz

  // control inputs
  var switches = [0,0,0];
  var keycode = 0;

  // inspect feature  
  var inspect_obj, inspect_sym;
  var inspect_data = new Uint32Array(videoWidth * videoHeight);

  // for scope
  var module_name;
  //var trace_ports;
  var trace_signals;
  var trace_buffer;
  var trace_index;

  // for virtual CRT
  var framex=0;
  var framey=0;
  var frameidx=0;
  var framehsync=false;
  var framevsync=false;
  var scanlineCycles = 0;

  var RGBLOOKUP = [
    0xff222222,
    0xff2222ff,
    0xff22ff22,
    0xff22ffff,
    0xffff2222,
    0xffff22ff,
    0xffffff22,
    0xffffffff,
    0xff999999,
    0xff9999ff,
    0xff99ff99,
    0xff99ffff,
    0xffff9999,
    0xffff99ff,
    0xffffff99,
    0xff666666,
  ];

  var debugCond;
  var frameRate = 0;

  function vidtick() {
    top.tick2(1);
    if (useAudio) {
      audio.feedSample(top.state.spkr, 1);
    }
    resetKbdStrobe();
    if (debugCond && debugCond()) {
      debugCond = null;
    }
  }

  function resetKbdStrobe() {
    if (keycode && keycode >= 128 && top.state.keystrobe) { // keystrobe = clear hi bit of key buffer
      keycode = keycode & 0x7f;
      top.state.keycode = keycode;
    }
  }

  function doreset() {
    top.state.reset = 1;
  }

  function unreset() {
    top.state.reset = 0;
  }

  // inner Platform class
    
 class _VerilogPlatform extends BasePlatform implements WaveformProvider {
 
  waveview : WaveformView;
  wavediv : JQuery;
  topdiv : JQuery;
  split;
  hasvideo : boolean;

  getPresets() { return VERILOG_PRESETS; }

  setVideoParams(width:number, height:number, clock:number) {
    videoWidth = width;
    videoHeight = height;
    cyclesPerFrame = clock;
    maxVideoLines = height+40;
  }

  async start() {
    await loadScript('./gen/common/hdl/hdltypes.js');
    await loadScript('./gen/common/hdl/hdlruntime.js');
    await loadScript('./gen/common/hdl/hdlwasm.js');
    await loadScript('./node_modules/binaryen/index.js'); // TODO: path?
    video = new RasterVideo(mainElement,videoWidth,videoHeight,{overscan:true});
    video.create();
    poller = setKeyboardFromMap(video, switches, VERILOG_KEYCODE_MAP, (o,key,code,flags) => {
      if (flags & KeyFlags.KeyPress) {
        keycode = code | 0x80;
      }
    }, true); // true = always send function
    var vcanvas = $(video.canvas);
    idata = video.getFrameData();
    timerCallback = () => {
      if (!this.isRunning())
        return;
      if (top) top.state.switches = switches[0];
      this.updateFrame();
    };
    this.setFrameRate(60);
    // setup scope
    trace_buffer = new Uint32Array(TRACE_BUFFER_DWORDS);
    var overlay = $("#emuoverlay").show();
    this.topdiv = $('<div class="emuspacer">').appendTo(overlay);
    vcanvas.appendTo(this.topdiv);
    this.wavediv = $('<div class="emuscope">').appendTo(overlay);
    this.split = Split( [this.topdiv[0], this.wavediv[0]], {
      minSize: [0,0],
      sizes: [99,1],
      direction: 'vertical',
      gutterSize: 16,
      onDrag: () => {
        this.resize();
        //if (this.waveview) this.waveview.recreate();
        //vcanvas.css('position','relative');
        //vcanvas.css('top', -this.wavediv.height()+'px');
      },
    });
    // setup mouse events
    video.setupMouseEvents();
    // setup mouse click
    video.vcanvas.click( (e) => {
      if (!top) return; // must have created emulator
      if (!e.ctrlKey) {
        //setFrameRateUI(60);
        return; // ctrl key must be down
      }
      setFrameRateUI(1.0/2048);
      var pos = getMousePos(video.canvas, e);
      var new_y = Math.floor(pos.y);
      var clock = 0;
      while (framey != new_y || clock++ > 200000) {
        this.setGenInputs();
        this.updateVideoFrameCycles(1, true, false);
        unreset();
      }
    });
  }
  
  // TODO: pollControls() { poller.poll(); }
  
  resize() {
    if (this.waveview) this.waveview.recreate();
  }
  
  setGenInputs() {
    useAudio = audio != null && top.state.spkr != null;
    usePaddles = top.state.hpaddle != null || top.state.vpaddle != null;
    //TODO debugCond = this.getDebugCallback();
    top.state.switches_p1 = switches[0];
    top.state.switches_p2 = switches[1];
    top.state.switches_gen = switches[2];
    top.state.keycode = keycode;
  }
  
  updateVideoFrame() {
    //this.topdiv.show(); //show crt
    this.setGenInputs();
    var fps = this.getFrameRate();
    // darken the previous frame?
    var sync = fps > 45;
    if (!sync) {
      var mask = fps > 5 ? 0xe7ffffff : 0x7fdddddd;
      for (var i=0; i<idata.length; i++)
        idata[i] &= mask;
    }
    // paint into frame, synched with vsync if full speed
    var trace = this.isScopeVisible();
    this.updateVideoFrameCycles(cyclesPerFrame * fps/60 + 1, sync, trace);
    if (fps < 0.25) {
      idata[frameidx] = -1;
    }
    //this.restartDebugState();
    unreset();
    this.refreshVideoFrame();
    // set scope offset
    if (trace && this.waveview) {
      this.waveview.setCurrentTime(Math.floor(trace_index/trace_signals.length));
    }
  }
  
  isScopeVisible() {
    return this.split.getSizes()[1] > 2; // TODO?
  }

  // TODO: merge with prev func  
  advance(novideo : boolean) : number {
    this.setGenInputs();
    this.updateVideoFrameCycles(cyclesPerFrame, true, false);
    unreset();
    if (!novideo) {
      this.refreshVideoFrame();
    }
    if (this.isBlocked()) {
      this.pause();
    }
    return cyclesPerFrame; //TODO?
  }
  
  refreshVideoFrame() {
    this.updateInspectionFrame();
    video.updateFrame();
    this.updateInspectionPostFrame();
  }
  
  refreshScopeOverlay() {
    // TODO
  }
  
  updateScopeFrame() {
    this.split.setSizes([0,100]); // ensure scope visible
    //this.topdiv.hide();// hide crt
    var done = this.fillTraceBuffer(CYCLES_PER_FILL * trace_signals.length);
    if (done)
      this.pause(); // TODO?
    // TODO
  }
  
  updateScope() {
    // create scope, if visible
    if (this.isScopeVisible()) {
      if (!this.waveview) {
        this.waveview = new WaveformView(this.wavediv[0] as HTMLElement, this);
      } else {
        this.waveview.refresh();
      }
    }
  }

  updateFrame() {
    if (!top) return;
    if (this.hasvideo)
      this.updateVideoFrame();
    else
      this.updateScopeFrame();
    this.updateScope();
  }

  updateInspectionFrame() {
    useAudio = false;
    if (inspect_obj && inspect_sym) {
      var COLOR_BIT_OFF = 0xffff6666;
      var COLOR_BIT_ON  = 0xffff9999;
      var i = videoWidth;
      for (var y=0; y<videoHeight-2; y++) {
        for (var x=0; x<videoWidth; x++) {
          var val = inspect_data[i];
          idata[i++] = (val & 1) ? COLOR_BIT_ON : COLOR_BIT_OFF;
        }
      }
    }
  }

  updateInspectionPostFrame() {
    if (inspect_obj && inspect_sym) {
      var ctx = video.getContext();
      var val = inspect_data[inspect_data.length-1];
      ctx.fillStyle = "black";
      ctx.fillRect(18, videoHeight-8, 30, 8);
      ctx.fillStyle = "white";
      ctx.fillText(val.toString(10), 20, videoHeight-1);
    }
  }

  updateVideoFrameCycles(ncycles:number, sync:boolean, trace:boolean) : void {
    ncycles |= 0;
    var inspect = inspect_obj && inspect_sym;
    // use fast trace buffer-based update?
    if (sync && !trace && top['trace'] != null && scanlineCycles > 0) {
      this.updateVideoFrameFast((top as any) as HDLModuleTrace);
      this.updateRecorder();
      return;
    }
    if (!sync) scanlineCycles = 0;
    // use slow update method
    var trace0 = trace_index;
    while (ncycles--) {
      if (trace) {
        this.snapshotTrace();
        if (trace_index == trace0) trace = false; // kill trace when wraps around
      }
      vidtick();
      if (framex++ < videoWidth) {
        if (framey < videoHeight) {
          if (inspect) {
            inspect_data[frameidx] = inspect_obj[inspect_sym];
          }
          let rgb = top.state.rgb;
          idata[frameidx] = rgb & 0x80000000 ? rgb : RGBLOOKUP[rgb & 15];
          frameidx++;
        }
      } else if (!framehsync && top.state.hsync) {
        framehsync = true;
      } else if ((framehsync && !top.state.hsync) || framex > videoWidth*2) {
        framehsync = false;
        if (sync) scanlineCycles = framex;
        framex = 0;
        framey++;
        top.state.hpaddle = framey > video.paddle_x ? 1 : 0;
        top.state.vpaddle = framey > video.paddle_y ? 1 : 0;
      }
      if (framey > maxVideoLines || top.state.vsync) {
        framevsync = true;
        framey = 0;
        framex = 0;
        frameidx = 0;
        top.state.hpaddle = 0;
        top.state.vpaddle = 0;
      } else {
        var wasvsync = framevsync;
        framevsync = false;
        if (sync && wasvsync) {
          this.updateRecorder();
          return; // exit when vsync ends
        }
      }
    }
  }

  // use trace buffer to update video
  updateVideoFrameFast(tmod: HDLModuleTrace) {
    var maxLineCycles = 1009; // prime number so we eventually sync up
    var nextlineCycles = scanlineCycles;
    // TODO: we can go faster if no paddle/sound
    frameidx = 0;
    var wasvsync = false;
    // audio feed
    function spkr() { if (useAudio) audio.feedSample(tmod.trace.spkr, 1); }
    // iterate through a frame of scanlines + room for vsync
    for (framey=0; framey<videoHeight*2; framey++) {
      if (usePaddles && framey < videoHeight) {
        top.state.hpaddle = framey > video.paddle_x ? 1 : 0;
        top.state.vpaddle = framey > video.paddle_y ? 1 : 0;
      }
      // generate frames in trace buffer
      top.tick2(nextlineCycles);
      // TODO: this has to be done more quickly
      resetKbdStrobe();
      // convert trace buffer to video/audio
      var n = 0;
      // draw scanline visible pixels
      if (framey < videoHeight) {
        for (framex=0; framex<videoWidth; framex++) {
          var rgb = tmod.trace.rgb;
          //if (tmod.trace.hsync) rgb ^= Math.random() * 15;
          idata[frameidx++] = rgb & 0x80000000 ? rgb : RGBLOOKUP[rgb & 15];
          spkr();
          tmod.nextTrace();
        }
        n += videoWidth;
      }
      // find hsync
      var hsyncStart=0, hsyncEnd=0;
      while (n < nextlineCycles) {
        if (tmod.trace.hsync) {
          if (!hsyncStart) hsyncStart = n;
          hsyncEnd = n;
        } else if (hsyncEnd)
          break;
        spkr();
        tmod.nextTrace();
        n++;
      }
      // see if our scanline cycle count is stable (can't read tmod.trace after end of line)
      if (hsyncStart < hsyncEnd && hsyncEnd == scanlineCycles-1) {
        // scanline cycle count locked in, reset buffer to improve cache locality
        nextlineCycles = scanlineCycles;
        tmod.resetTrace();
      } else {
        // not in sync, don't reset buffer (TODO: take some of the cycles back)
        //console.log('scanline', framey, scanlineCycles, nextlineCycles, n, hsyncStart, hsyncEnd);
        nextlineCycles = Math.min(maxLineCycles, n + scanlineCycles);
      }
      // exit when vsync starts and then stops
      if (tmod.trace.vsync) {
        wasvsync = true;
        top.state.hpaddle = 0;
        top.state.vpaddle = 0;
      } else if (wasvsync) {
        break;
      }
    }
  }

  snapshotTrace() {
    var arr = trace_signals;
    for (var i=0; i<arr.length; i++) {
      var v = arr[i];
      var z = top.state[v.name];
      trace_buffer[trace_index] = z+0;
      trace_index++;
    }
    if (trace_index >= trace_buffer.length - arr.length)
      trace_index = 0;
  }

  fillTraceBuffer(count:number) : boolean {
    var max_index = Math.min(trace_buffer.length - trace_signals.length, trace_index + count);
    while (trace_index < max_index) {
      top.tick();
      this.snapshotTrace();
      if (trace_index == 0)
        break;
    }
    unreset();
    return (trace_index == 0);
  }
  
  getSignalMetadata() : WaveformMeta[] {
    return trace_signals;
  }
  
  getSignalData(index:number, start:number, len:number) : number[] {
    // TODO: not efficient
    var skip = this.getSignalMetadata().length;
    var last = trace_buffer.length - trace_signals.length; // TODO: refactor, and not correct
    var wrap = this.hasvideo; // TODO?
    var a = [];
    index += skip * start;
    while (index < last && a.length < len) {
      a.push(trace_buffer[index]);
      index += skip;
      if (wrap && index >= last) // TODO: what if starts with index==last
        index = 0;
    }
    return a;
  }

  setSignalValue(index:number, value:number) {
    var meta = this.getSignalMetadata()[index];
    top.state[meta.label] = value;
    this.reset();
  }

  printErrorCodeContext(e, code) {
    if (e.lineNumber && e.message) {
      var lines = code.split('\n');
      var s = e.message + '\n';
      for (var i=0; i<lines.length; i++) {
        if (i > e.lineNumber-5 && i < e.lineNumber+5) {
          s += lines[i] + '\n';
        }
      }
      console.log(s);
    }
  }

  dispose() {
    if (top) {
        top.dispose();
        top = null;
    }
  }

  // TODO: can this be async?
  async loadROM(title:string, output:any) {
    var unit = output as HDLUnit;
    var topmod = unit.modules['TOP'];
    if (unit.modules && topmod) {
      {
        // initialize top module and constant pool
        var useWASM = true;
        var topcons = useWASM ? HDLModuleWASM : HDLModuleJS;
        var _top = new topcons(topmod, unit.modules['@CONST-POOL@']);
        _top.getFileData = (path) => current_project.filedata[path]; // external file provider
        await _top.init();
        _top.powercycle();
        this.dispose();
        top = _top;
        // create signal array
        var signals : WaveformSignal[] = [];
        for (var key in topmod.vardefs) {
          var vardef = topmod.vardefs[key];
          if (isLogicType(vardef.dtype)) {
            signals.push({
              name: key,
              label: vardef.origName,
              input: vardef.isInput,
              output: vardef.isOutput,
              len: vardef.dtype.left+1
            });
          }
        }
        trace_signals = signals;
        trace_signals = trace_signals.filter((v) => { return !v.label.startsWith("__V"); }); // remove __Vclklast etc
        trace_index = 0;
        // reset
        this.poweron();
        // query output signals -- video or not?
        this.hasvideo = top.state.vsync != null && top.state.hsync != null && top.state.rgb != null;
        if (this.hasvideo) {
          const IGNORE_SIGNALS = ['clk','reset'];
          trace_signals = trace_signals.filter((v) => { return IGNORE_SIGNALS.indexOf(v.name)<0; }); // remove clk, reset
          $("#speed_bar").show();
          $("#run_bar").show();
          $("#xtra_bar").show();
        } else {
          $("#speed_bar").hide();
          $("#run_bar").hide();
          $("#xtra_bar").hide();
        }
      }
    }
    // replace program ROM, if using the assembler
    this.reset();
    // TODO: fix this, it ain't good
    if (output.program_rom && output.program_rom_variable) {
      if (top.state[output.program_rom_variable]) {
        if (top.state[output.program_rom_variable].length != output.program_rom.length)
          alert("ROM size mismatch -- expected " + top.state[output.program_rom_variable].length + " got " + output.program_rom.length);
        else
          top.state[output.program_rom_variable].set(output.program_rom);
      } else {
        alert("No program_rom variable found (" + output.program_rom_variable + ")");
      }
    }
    // restart audio
    this.restartAudio();
    if (this.waveview) {
      this.waveview.recreate();
    }
  }
  
  restartAudio() {
    // stop/start audio
    var hasAudio = top && top.state.spkr != null && frameRate > 1;
    if (audio && !hasAudio) {
      audio.stop();
      audio = null;
    } else if (!audio && hasAudio) {
      audio = new SampleAudio(cyclesPerFrame * this.getFrameRate());
      if (this.isRunning())
        audio.start();
    }
  }

  isRunning() {
    return timer && timer.isRunning();
  }
  pause() {
    timer.stop();
    if (audio) audio.stop();
  }
  resume() {
    timer.start();
    if (audio) audio.start();
  }

  isBlocked() {
    return top && top.isFinished();
  }
  isStopped() {
    return top && top.isStopped();
  }

  setFrameRate(rateHz) {
    frameRate = rateHz;
    var fps = Math.min(60, rateHz*cyclesPerFrame);
    if (!timer || timer.frameRate != fps) {
      var running = this.isRunning();
      if (timer) timer.stop();
      timer = new AnimationTimer(fps, timerCallback);
      if (running) timer.start();
    }
    if (audio) {
      audio.stop();
      audio = null;
    }
    this.restartAudio();
  }  
  getFrameRate() { return frameRate; }

  poweron() {
    top.powercycle();
    this.reset();
  }
  reset() {
    if (!top) return;
    //top.reset(); // to avoid clobbering user inputs
    doreset();
    trace_index = 0;
    if (trace_buffer) trace_buffer.fill(0);
    if (video) video.setRotate(top.state.rotate ? -90 : 0);
    $("#verilog_bar").hide();
    if (!this.hasvideo) this.resume(); // TODO?
  }
  tick() {
    top.tick2(1);
  }
  getToolForFilename(fn) {
    if (fn.endsWith(".asm")) return "jsasm";
    else if (fn.endsWith(".ice")) return "silice";
    else return "verilator";
  }
  getDefaultExtension() { return ".v"; };

  inspect(name:string) : string {
    if (!top) return;
    if (name) name = name.replace('.','_');
    if (!name || !name.match(/^\w+$/)) {
      inspect_obj = inspect_sym = null;
      return;
    }
    var val = top.state[name];
    /* TODO
    if (val === undefined && current_output.code) {
      var re = new RegExp("(\\w+__DOT__(?:_[dcw]_)" + name + ")\\b", "gm");
      var m = re.exec(current_output.code);
      if (m) {
        name = m[1];
        val = gen[name];
      }
    }
    */
    if (typeof(val) === 'number') {
      inspect_obj = top.state;
      inspect_sym = name;
    } else {
      inspect_obj = inspect_sym = null;
    }
  }

  // DEBUGGING

  getDebugTree() {
    return {
      runtime: top,
      state: top.getGlobals()
    }
  }

  // TODO: bind() a function to avoid depot?
  saveState() {
    return {o: top.saveState()};
  }

  loadState(state) {
    top.loadState(state.o);
  }

  saveControlsState() {
    return {
      p1x: video.paddle_x,
      p1y: video.paddle_y,
      sw0: switches[0],
      sw1: switches[1],
      sw2: switches[2],
      keycode: keycode
    };
  }
  loadControlsState(state) {
    video.paddle_x = state.p1x;
    video.paddle_y = state.p1y;
    switches[0] = state.sw0;
    switches[1] = state.sw1;
    switches[2] = state.sw2;
    keycode = state.keycode;
  }
  getDownloadFile() {
    // TODO: WASM code too?
    if (top instanceof HDLModuleJS) {
      return {
        extension:".js", 
        blob: new Blob([top.getJSCode()], {type:"text/plain"})
      };
    }
  }

 } // end of inner class
 return new _VerilogPlatform();  
};

////////////////

var VERILOG_VGA_PRESETS = [
  {id:'hvsync_generator.v', name:'Video Sync Generator'},
  {id:'test_hvsync.v', name:'Test Pattern'},
  {id:'chardisplay.v', name:'RAM Text Display'},
  {id:'starfield.v', name:'Scrolling Starfield'},
  {id:'ball_paddle.v', name:'Brick Smash Game'},
];


var VerilogVGAPlatform = function(mainElement, options) {
  this.__proto__ = new (VerilogPlatform as any)(mainElement, options);

  this.getPresets = function() { return VERILOG_VGA_PRESETS; }

  this.setVideoParams(800-64, 520, 25000000);
}

////////////////

PLATFORMS['verilog'] = VerilogPlatform;
PLATFORMS['verilog-vga'] = VerilogVGAPlatform;
PLATFORMS['verilog-test'] = VerilogPlatform;
