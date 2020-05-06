import { dimensionsOf } from './util.js';

import * as EBML from 'ts-ebml';

export default class Recorder {

  #recorder
  #data
  #decoder
  #reader
  #reading

  #dimensions

  onStop

  constructor(stream, settings, options = {}) {
    // Figure out MIME type.
    let mimeType;
    if ('isTypeSupported' in MediaRecorder) {
      mimeType = (settings?.mimes || [])
        .find(mime => MediaRecorder.isTypeSupported(mime));
      if (mimeType) {
        console.debug("using first supported MIME type from settings: ", mimeType);
      } else if (settings?.mimes) {
        console.debug("None of the MIME types specified in settings are supported by "
          + "this `MediaRecorder`");
      }
    } else if (settings?.mimes) {
      console.debug("MIME types were specified, but `MediaRecorder.isTypeSupported` is not "
        + "supported by your browser");
    }


    this.#reset();

    this.#dimensions = dimensionsOf(stream);
    const videoBitsPerSecond = settings?.videoBitrate;
    this.onStop = options.onStop;

    this.#recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond });
    // TODO Use `addEventListener`!
    this.#recorder.ondataavailable = this.#onDataAvailable;
    this.#recorder.onstop = this.#onStop;
  }

  // TODO The following methods should live on the prototype.
  //   Remember that you have to bind the event handlers then, though.

  #reset = () => {
    this.#data = [];
    // TODO Can we reuse these?
    this.#decoder = new EBML.Decoder();
    this.#reader = new EBML.Reader();
    this.#reader.logging = false;
    this.#reader.drop_default_duration = false;
    this.#reading = Promise.resolve();
  }

  // TODO What if the data is not EBML?!

  #onDataAvailable = event => {
    if (event.data.size > 0) {
      this.#data.push(event.data);
      const decoder = this.#decoder;
      const reader = this.#reader;
      this.#reading = this.#reading.then(async () => {
        for (const element of decoder.decode(await event.data.arrayBuffer())) {
          reader.read(element);
        }
      });
    } else {
      console.log("Recording data has size 0!", event);
    }
  }

  #onStop = async event => {
    // Snapshot the state so it doesn't change under our nose
    // while waiting for async stuff to happen
    const mimeType = this.#data[0]?.type || this.#recorder.mimeType;
    const data = this.#data;
    const reader = this.#reader;
    const reading = this.#reading;
    const onStop = this.onStop;

    // We already reset here so the recorder can be reused,
    // while the finalization is running asynchronously
    this.#reset();

    // TODO We have to wait for everything ...
    await reading;
    reader.stop();

    const refinedMetadata = EBML.tools.makeMetadataSeekable(
      reader.metadatas,
      reader.duration,
      reader.cues,
    );

    // To replace the metadata in the original blob,
    // we first need to extract the body from the original metadata.
    // For that, we look for the first blob, that does not belong
    // to the metadata section.
    // We do this by successively subtracting our blobs' size
    // from the known metadata size unti there is nothing left.
    let firstBodyBlob = 0;
    let metadataRestSize = reader.metadataSize;
    while (firstBodyBlob < data.length && metadataRestSize >= data[firstBodyBlob].size) {
      metadataRestSize -= data[firstBodyBlob].size;
      ++firstBodyBlob;
    }
    data.splice(0, firstBodyBlob);
    if (data.length) {
      data[0] = data[0].slice(metadataRestSize);
    }
    data.unshift(refinedMetadata);

    // TODO Off this sucks
    // TODO Is setting the type like this okay?
    // TODO Think about the names ... Also `data` is not that good ...
    // Finalize everything and send it on its way
    const media = new Blob(data, { type: mimeType });
    const url = URL.createObjectURL(media);
    // TODO Why pass the type here ...?
    onStop?.({ url, media, mimeType, dimensions: this.#dimensions });
  }

  start() {
    // TODO What is a sensible value here?
    //this.#recorder.start(5000);
    this.#recorder.start(5000);
  }

  pause() {
    this.#recorder.pause();
  }

  resume() {
    this.#recorder.resume();
  }

  stop() {
    this.#recorder.stop();
  }
}
