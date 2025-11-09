declare module 'remarkable' {
  export class Remarkable {
    constructor(preset: string, options?: any);
    render(markdown: string): string;
  }
}

declare module 'duplexer' {
  function duplexer(writable: any, readable: any): any;
  export = duplexer;
}

declare module 'stream-from-to' {
  function streamft(fn: () => any): any;
  export = streamft;
}

declare module 'phantomjs-prebuilt' {
  const phantomjs: {
    path: string;
  };
  export = phantomjs;
}
