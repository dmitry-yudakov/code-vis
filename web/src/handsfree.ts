import { debounce } from 'lodash';
// eslint-disable-next-line
// import * as Handsfree from 'handsfree';
const { Handsfree } = window as any;

let handsfree: any = null;

export const initHandsfree = () => {
  // Let's use handtracking and enable the plugins tagged with "browser"
  handsfree = new Handsfree({
    showDebug: true,
    hands: true,
    weboji: true,
  });
  handsfree.enablePlugins('browser');
  handsfree.start();

  const log = (data: any) => {
    console.log(
      data.weboji.morphs,
      data.weboji.rotation,
      data.weboji.pointer,
      data.weboji.state.browsUp,
      data,
      this
    );
  };
  const debounceLog = debounce(log, 250, { maxWait: 1000 });

  handsfree.use('logger', debounceLog);
};

export const disableHandsfree = () => {
  if (handsfree) {
    handsfree.stop();
    handsfree = null;
  }
};
