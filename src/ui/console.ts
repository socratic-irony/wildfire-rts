/**
 * Command console for introspection and debugging
 * 
 * Provides a text-based interface for executing debug commands
 * without directly coupling to forbidden systems.
 */

import { getConfigValue, setConfigValue } from '../config/features';

export interface Command {
  name: string;
  description: string;
  execute: (args: string[]) => string | Promise<string>;
}

export interface ConsoleOptions {
  maxHistory: number;
  maxOutput: number;
}

/**
 * Debug console implementation
 */
export class DebugConsole {
  private element: HTMLDivElement;
  private input: HTMLInputElement;
  private output: HTMLDivElement;
  private visible: boolean = false;
  private commands: Map<string, Command> = new Map();
  private history: string[] = [];
  private historyIndex: number = -1;
  private outputLines: string[] = [];
  private options: ConsoleOptions;

  constructor(container: HTMLElement, options: Partial<ConsoleOptions> = {}) {
    this.options = {
      maxHistory: 50,
      maxOutput: 100,
      ...options
    };

    this.createElement(container);
    this.registerBuiltinCommands();
    this.setupKeyboardHandlers();
  }

  private createElement(container: HTMLElement): void {
    this.element = document.createElement('div');
    this.element.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 40%;
      background: rgba(0, 0, 0, 0.9);
      border-top: 1px solid #333;
      display: none;
      flex-direction: column;
      font: 12px/1.4 'Courier New', monospace;
      color: #e5e7eb;
      z-index: 1000;
    `;

    // Output area
    this.output = document.createElement('div');
    this.output.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 8px 12px;
      white-space: pre-wrap;
      font-family: inherit;
    `;

    // Input area
    const inputContainer = document.createElement('div');
    inputContainer.style.cssText = `
      border-top: 1px solid #333;
      padding: 8px 12px;
      display: flex;
      align-items: center;
    `;

    const prompt = document.createElement('span');
    prompt.textContent = '> ';
    prompt.style.color = '#60a5fa';

    this.input = document.createElement('input');
    this.input.style.cssText = `
      flex: 1;
      background: transparent;
      border: none;
      color: inherit;
      font: inherit;
      outline: none;
      margin-left: 4px;
    `;

    inputContainer.appendChild(prompt);
    inputContainer.appendChild(this.input);
    this.element.appendChild(this.output);
    this.element.appendChild(inputContainer);
    container.appendChild(this.element);
  }

  private setupKeyboardHandlers(): void {
    // Global keyboard handler for console toggle
    document.addEventListener('keydown', (e) => {
      if (e.key === '`' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        this.toggle();
      }
      if (e.key === 'Escape' && this.visible) {
        e.preventDefault();
        this.hide();
      }
    });

    // Input handlers
    this.input.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          this.executeCommand(this.input.value.trim());
          this.input.value = '';
          this.historyIndex = -1;
          break;

        case 'ArrowUp':
          e.preventDefault();
          this.navigateHistory(-1);
          break;

        case 'ArrowDown':
          e.preventDefault();
          this.navigateHistory(1);
          break;

        case 'Tab':
          e.preventDefault();
          this.autocomplete();
          break;
      }
    });
  }

  private navigateHistory(direction: number): void {
    if (this.history.length === 0) return;

    this.historyIndex += direction;
    this.historyIndex = Math.max(-1, Math.min(this.history.length - 1, this.historyIndex));

    if (this.historyIndex >= 0) {
      this.input.value = this.history[this.historyIndex];
    } else {
      this.input.value = '';
    }
  }

  private autocomplete(): void {
    const input = this.input.value;
    const matches = Array.from(this.commands.keys()).filter(cmd => cmd.startsWith(input));
    
    if (matches.length === 1) {
      this.input.value = matches[0];
    } else if (matches.length > 1) {
      this.log(`Available: ${matches.join(', ')}`);
    }
  }

  private async executeCommand(input: string): Promise<void> {
    if (!input) return;

    // Add to history
    this.history.unshift(input);
    if (this.history.length > this.options.maxHistory) {
      this.history.pop();
    }

    // Echo command
    this.log(`> ${input}`, '#60a5fa');

    // Parse command
    const parts = input.split(' ');
    const commandName = parts[0];
    const args = parts.slice(1);

    const command = this.commands.get(commandName);
    if (!command) {
      this.log(`Unknown command: ${commandName}`, '#ef4444');
      this.log('Type "help" for available commands.');
      return;
    }

    try {
      const result = await command.execute(args);
      if (result) {
        this.log(result);
      }
    } catch (error) {
      this.log(`Error: ${error instanceof Error ? error.message : String(error)}`, '#ef4444');
    }
  }

  private log(message: string, color: string = '#e5e7eb'): void {
    const line = `<span style="color: ${color}">${this.escapeHtml(message)}</span>`;
    this.outputLines.push(line);
    
    // Limit output history
    if (this.outputLines.length > this.options.maxOutput) {
      this.outputLines.shift();
    }
    
    this.updateOutput();
  }

  private updateOutput(): void {
    this.output.innerHTML = this.outputLines.join('\n');
    this.output.scrollTop = this.output.scrollHeight;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private registerBuiltinCommands(): void {
    // Help command
    this.registerCommand({
      name: 'help',
      description: 'Show available commands',
      execute: () => {
        const commands = Array.from(this.commands.values())
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(cmd => `  ${cmd.name.padEnd(20)} - ${cmd.description}`)
          .join('\n');
        return `Available commands:\n${commands}`;
      }
    });

    // Clear command
    this.registerCommand({
      name: 'clear',
      description: 'Clear console output',
      execute: () => {
        this.outputLines = [];
        this.updateOutput();
        return '';
      }
    });

    // Config commands
    this.registerCommand({
      name: 'config',
      description: 'Get or set configuration values',
      execute: (args) => {
        if (args.length === 0) {
          return 'Usage: config <key> [value]';
        }
        
        const key = args[0];
        if (args.length === 1) {
          const value = getConfigValue(key);
          return value !== undefined ? `${key} = ${JSON.stringify(value)}` : `Unknown config key: ${key}`;
        } else {
          const value = args[1];
          try {
            const parsedValue = JSON.parse(value);
            setConfigValue(key, parsedValue);
            return `Set ${key} = ${JSON.stringify(parsedValue)}`;
          } catch {
            setConfigValue(key, value);
            return `Set ${key} = "${value}"`;
          }
        }
      }
    });

    // Performance command
    this.registerCommand({
      name: 'perf.memory',
      description: 'Display memory usage information',
      execute: () => {
        if ('memory' in performance) {
          const mem = (performance as any).memory;
          return [
            'Memory Usage:',
            `  Used: ${(mem.usedJSHeapSize / 1048576).toFixed(2)} MB`,
            `  Total: ${(mem.totalJSHeapSize / 1048576).toFixed(2)} MB`,
            `  Limit: ${(mem.jsHeapSizeLimit / 1048576).toFixed(2)} MB`
          ].join('\n');
        } else {
          return 'Memory information not available in this browser.';
        }
      }
    });
  }

  /**
   * Register a new command
   */
  registerCommand(command: Command): void {
    this.commands.set(command.name, command);
  }

  /**
   * Remove a command
   */
  unregisterCommand(name: string): void {
    this.commands.delete(name);
  }

  /**
   * Show the console
   */
  show(): void {
    this.visible = true;
    this.element.style.display = 'flex';
    this.input.focus();
  }

  /**
   * Hide the console
   */
  hide(): void {
    this.visible = false;
    this.element.style.display = 'none';
  }

  /**
   * Toggle console visibility
   */
  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Check if console is visible
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Add a log message from external code
   */
  addLog(message: string, color?: string): void {
    this.log(message, color);
  }
}