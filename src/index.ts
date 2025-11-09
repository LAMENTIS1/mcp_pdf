#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  Request,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import express from "express";   // ✅ ADDED FOR RENDER WEB SERVICE

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const hljs = require('highlight.js');
const tmp = require('tmp');
const { Remarkable } = require('remarkable');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

tmp.setGracefulCleanup();

export class MarkdownPdfServer {
  private server;
  private transport = null;
  private isRunning = false;

  constructor() {
    this.server = new Server(
      {
        name: 'markdown2pdf',
        version: pkg.version,
      },
      {
        capabilities: {
          tools: {
            create_pdf_from_markdown: true,
          },
        },
      }
    );

    this.setupToolHandlers();

    this.server.onerror = (error) => {
      const mcpError = new McpError(
        ErrorCode.InternalError,
        `Server error: ${error.message}`,
        {
          details: { name: error.name, stack: error.stack },
        }
      );
      throw mcpError;
    };

    const handleShutdown = async (signal) => {
      try {
        await this.server.close();
      } catch (error) {
        const mcpError = new McpError(
          ErrorCode.InternalError,
          `Server shutdown error during ${signal}: ${error.message}`,
          {
            details: { signal, name: error.name, stack: error.stack },
          }
        );
        throw mcpError;
      } finally {
        process.exit(0);
      }
    };

    process.once('SIGINT', () => handleShutdown('SIGINT').catch(() => process.exit(1)));
    process.once('SIGTERM', () => handleShutdown('SIGTERM').catch(() => process.exit(1)));
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'create_pdf_from_markdown',
          description:
            'Convert markdown content to PDF.',
          inputSchema: {
            type: 'object',
            properties: {
              markdown: { type: 'string' },
              outputFilename: { type: 'string' },
              paperFormat: {
                type: 'string',
                enum: ['letter', 'a4', 'a3', 'a5', 'legal', 'tabloid'],
              },
              paperOrientation: {
                type: 'string',
                enum: ['portrait', 'landscape'],
              },
              paperBorder: { type: 'string' },
              watermark: { type: 'string' },
              watermarkScope: {
                type: 'string',
                enum: ['all-pages', 'first-page'],
              },
              showPageNumbers: { type: 'boolean' },
            },
            required: ['markdown'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'create_pdf_from_markdown') {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
      }

      const args = request.params.arguments;
      if (!args) throw new McpError(ErrorCode.InvalidParams, 'No arguments provided');

      const {
        markdown,
        outputFilename = 'output.pdf',
        paperFormat = 'letter',
        paperOrientation = 'portrait',
        paperBorder = '2cm',
        watermark = '',
        watermarkScope = 'all-pages',
        showPageNumbers = false,
      } = args;

      if (!markdown || typeof markdown !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'Missing markdown');
      }

      const outputDir =
        process.env.M2P_OUTPUT_DIR ||
        path.resolve(os.homedir());

      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      const outPath = path.join(outputDir, outputFilename.endsWith('.pdf') ? outputFilename : `${outputFilename}.pdf`);

      await this.convertToPdf(
        markdown,
        outPath,
        paperFormat,
        paperOrientation,
        paperBorder,
        watermark,
        watermarkScope,
        showPageNumbers
      );

      return {
        content: [
          {
            type: 'text',
            text: `✅ PDF created at: ${outPath}`,
          },
        ],
      };
    });
  }

  private async convertToPdf(
    markdown,
    outputPath,
    paperFormat,
    paperOrientation,
    paperBorder,
    watermark,
    watermarkScope,
    showPageNumbers
  ) {
    const mdParser = new Remarkable({
      breaks: true,
      html: true,
      highlight: (str, lang) => {
        if (lang === 'mermaid') return `<div class="mermaid">${str}</div>`;
        try {
          return hljs.highlight(str, { language: lang }).value;
        } catch (e) {
          return hljs.highlightAuto(str).value;
        }
      },
    });

    // Create minimal HTML
    const html = `
<!DOCTYPE html>
<html>
<body>
  ${mdParser.render(markdown)}
</body>
</html>`;

    const tmpFile = tmp.tmpNameSync({ postfix: '.html' });
    await fs.promises.writeFile(tmpFile, html);

    const renderPDF = (await import('./puppeteer/render.js')).default;

    await renderPDF({
      htmlPath: tmpFile,
      pdfPath: outputPath,
      runningsPath: path.resolve(__dirname, 'runnings.js'),
      cssPath: path.resolve(__dirname, 'css', 'pdf.css'),
      highlightCssPath: '',
      paperFormat,
      paperOrientation,
      paperBorder,
      watermarkScope,
      showPageNumbers,
      renderDelay: 7000,
      loadTimeout: 60000,
    });
  }

  // -----------------------------
  // START MCP SERVER
  // -----------------------------
  public async run() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.transport = new StdioServerTransport();

    try {
      await this.server.connect(this.transport);

      return new Promise((resolve) => {
        const cleanup = async () => {
          if (this.transport) await this.server.close();
          resolve();
        };
        process.once('SIGINT', cleanup);
        process.once('SIGTERM', cleanup);
      });
    } catch (err) {
      this.isRunning = false;
      throw err;
    }
  }
}

// ------------------------------------------------------------
// ✅ EXPRESS WEB SERVER TO KEEP RENDER ALIVE
// ------------------------------------------------------------
function startHttpServer() {
  const app = express();

  app.get("/", (req, res) => {
    res.send("✅ Markdown2PDF MCP server is running successfully on Render.");
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`✅ HTTP server running on port ${port}`);
  });
}

// ------------------------------------------------------------
// ✅ MAIN ENTRYPOINT
// ------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {

  // ✅ Start HTTP server (required by Render)
  startHttpServer();

  // ✅ Start MCP server
  const server = new MarkdownPdfServer();
  server.run().catch((error) => {
    console.error("❌ MCP server failed:", error);
  });
}
