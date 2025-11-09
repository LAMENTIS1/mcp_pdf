#!/usr/bin/env node
export declare class MarkdownPdfServer {
    private server;
    constructor();
    private setupToolHandlers;
    private getIncrementalPath;
    private convertToPdf;
    private transport;
    private isRunning;
    run(): Promise<void>;
}
