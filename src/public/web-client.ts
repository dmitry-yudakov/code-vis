declare var webkitSpeechRecognition;
declare var webkitSpeechGrammarList;
declare var webkitSpeechRecognitionEvent;
declare var window;
declare var WebSocket;

var SpeechRecognition = SpeechRecognition || (typeof webkitSpeechRecognition !== 'undefined' ? webkitSpeechRecognition : undefined)
var SpeechGrammarList = SpeechGrammarList || (typeof webkitSpeechGrammarList !== 'undefined' ? webkitSpeechGrammarList : undefined)
var SpeechRecognitionEvent = SpeechRecognitionEvent || (typeof webkitSpeechRecognitionEvent !== 'undefined' ? webkitSpeechRecognitionEvent : undefined)



let rec;
let ws;
const reconnectws = () => {
    let protocol = (window.location.protocol === 'http:' ? 'ws' : 'wss')
    console.log('connect websocket')
    ws = new WebSocket(`${protocol}://${window.location.host}`)
    ws.onclose = () => setTimeout(() => {
        console.log('reconnect websocket')
        reconnectws()
    }, 1000)
    ws.onmessage = e => {
        console.log('ws message received', e.data)
        if (rec.stopped) {
            rec.recognition.start()
        }
    }
}
reconnectws()

function Recognizer(predefinedItems, cbResult) {
    this.cbResult = cbResult

    this.recognition = this.__init(predefinedItems)
    this.recognition.start();
    console.log('Ready to receive a command!!');
}

Recognizer.prototype.__init = function (predefinedItems) {
    var grammar = '#JSGF V1.0; grammar items; public <item> = ' + predefinedItems.join(' | ') + ' ;'

    var recognition = new SpeechRecognition();
    var speechRecognitionList = new SpeechGrammarList();
    speechRecognitionList.addFromString(grammar, 1);
    recognition.grammars = speechRecognitionList;
    // recognition.continuous = true;
    // recognition.lang = 'en-US';
    // recognition.lang = 'bg-BG';
    // recognition.interimResults = true;
    // recognition.maxAlternatives = 1;
    recognition.onresult = this.onresult.bind(this)
    // recognition.onspeechend = this.onspeechend.bind(this)
    recognition.onend = this.onspeechend.bind(this)
    recognition.onnomatch = this.onnomatch.bind(this)
    recognition.onerror = this.onerror.bind(this)
    return recognition
}

Recognizer.prototype.isSupported = function () {
    return (SpeechGrammarList != undefined)
}

Recognizer.prototype.stop = function () {
    this.recognition.stop()
}

Recognizer.prototype.onresult = function (event) {
    // The SpeechRecognitionEvent results property returns a SpeechRecognitionResultList object
    // The SpeechRecognitionResultList object contains SpeechRecognitionResult objects.
    // It has a getter so it can be accessed like an array
    // The [last] returns the SpeechRecognitionResult at the last position.
    // Each SpeechRecognitionResult object contains SpeechRecognitionAlternative objects that contain individual results.
    // These also have getters so they can be accessed like arrays.
    // The [0] returns the SpeechRecognitionAlternative at position 0.
    // We then return the transcript property of the SpeechRecognitionAlternative object
    console.log('results', event.results)
    var last = event.results.length - 1;
    var res = event.results[last][0].transcript;

    console.log('Result received: ' + res)
    console.log('Confidence: ' + event.results[0][0].confidence);
    this.cbResult(null, res)

    // console.log('On result - restart')
    // this.recognition.start();
}

Recognizer.prototype.onspeechend = function () {
    // this.recognition.stop();
    // console.log('On speech end - restart')
    // this.recognition.start();
    this.stopped = true
}

Recognizer.prototype.onnomatch = function (event) {
    this.cbResult("Sorry, I could not understand")
    console.log('No match')
}

Recognizer.prototype.onerror = function (event) {
    this.cbResult(event.error)
    console.log('Error occurred in recognition: ' + event.error)
}

rec = new Recognizer(['open'], (err, res) => {
    console.log('Recognized', err, res)
    console.log('Send to websocket')
    ws.send(JSON.stringify({ command: res }))
})

