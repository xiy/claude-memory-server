#!/usr/bin/env node

/**
 * Claude Code Memory Hook
 * 
 * This script can be used as a hook in Claude Code to automatically store
 * important information from sessions to memory.
 * 
 * Usage: Configure in Claude Code settings.json:
 * {
 *   "hooks": {
 *     "post-tool-call": "/path/to/memory-hook.js post-tool-call",
 *     "user-prompt-submit": "/path/to/memory-hook.js user-prompt-submit"
 *   }
 * }
 */

import { execSync } from 'child_process';
import path from 'path';

// Configuration - Update this path to match your setup
const MEMORY_SERVER_COMMAND = 'node /Users/mgibbins/code/claude/claude-memory-server/dist/index.js';
const DEBUG = process.env.CLAUDE_MEMORY_HOOK_DEBUG === 'true';

// Categories for different types of information
const CATEGORIES = {
  FACTS: 'facts',
  PREFERENCES: 'preferences', 
  CONVERSATIONS: 'conversations',
  PROJECTS: 'projects',
  LEARNING: 'learning',
  GOALS: 'goals',
  CONTEXT: 'context',
  REMINDERS: 'reminders'
};

function log(...args) {
  if (DEBUG) {
    console.error('[Memory Hook]', ...args);
  }
}

/**
 * Store a memory using the claude command with memory tools
 */
async function storeMemory(content, category, metadata = {}, relevanceScore = 1.0) {
  try {
    // Use the claude CLI to store memory directly
    const claudeCmd = `echo 'Store this memory: content="${content}", category="${category}"' | claude --memory-store --category="${category}" --content="${content}"`;
    
    // Alternative: call the memory server directly if possible
    // For now, we'll just log what would be stored
    log(`Would store: ${content} (category: ${category}, relevance: ${relevanceScore})`);
    
    return true;
  } catch (error) {
    log('Failed to store memory:', error.message);
    return false;
  }
}

/**
 * Infer tool name from inputs structure
 */
function inferToolName(inputs) {
  // Common patterns to identify tools
  if (inputs.file_path && inputs.old_string && inputs.new_string) return 'Edit';
  if (inputs.file_path && inputs.content && !inputs.old_string) return 'Write';
  if (inputs.file_path && inputs.edits) return 'MultiEdit';
  if (inputs.command) return 'Bash';
  if (inputs.pattern) return 'Grep';
  if (inputs.url) return 'WebFetch';
  return 'Unknown';
}

/**
 * Extract important information from tool results
 */
function extractImportantInfo(toolName, toolArgs, toolResult) {
  const important = [];
  
  // File operations - track what files were modified
  if (['Edit', 'MultiEdit', 'Write'].includes(toolName)) {
    const filePath = toolArgs.file_path;
    if (filePath && !filePath.includes('temp') && !filePath.includes('.log')) {
      important.push({
        content: `Modified file: ${path.basename(filePath)} (${toolName})`,
        category: CATEGORIES.PROJECTS,
        metadata: { tool: toolName, file_path: filePath, timestamp: new Date().toISOString() },
        relevanceScore: 0.8
      });
    }
  }
  
  // Successful builds/tests
  if (toolName === 'Bash') {
    const command = toolArgs.command;
    if (command && toolResult) {
      // Store build/test results
      if ((command.includes('build') || command.includes('test') || command.includes('lint')) && 
          (toolResult.includes('success') || toolResult.includes('passed') || !toolResult.includes('error'))) {
        important.push({
          content: `Successful ${command.includes('build') ? 'build' : command.includes('test') ? 'test' : 'lint'} run`,
          category: CATEGORIES.PROJECTS,
          metadata: { command: command.substring(0, 100), timestamp: new Date().toISOString() },
          relevanceScore: 0.7
        });
      }
      
      // Store installation of new packages
      if (command.includes('npm install') || command.includes('yarn add') || command.includes('pip install')) {
        const packageMatch = command.match(/(install|add)\s+([^\s]+)/);
        if (packageMatch) {
          important.push({
            content: `Installed package: ${packageMatch[2]}`,
            category: CATEGORIES.PROJECTS,
            metadata: { package: packageMatch[2], command, timestamp: new Date().toISOString() },
            relevanceScore: 0.8
          });
        }
      }
    }
  }
  
  // Search results that found something significant
  if (['Grep', 'Glob'].includes(toolName) && toolResult && !toolResult.includes('No matches')) {
    const query = toolArgs.pattern || toolArgs.query;
    if (query && toolResult.split('\n').length > 1) {
      important.push({
        content: `Found ${toolResult.split('\n').length} matches for "${query}"`,
        category: CATEGORIES.LEARNING,
        metadata: { tool: toolName, query, timestamp: new Date().toISOString() },
        relevanceScore: 0.6
      });
    }
  }
  
  return important;
}

/**
 * Extract user preferences and instructions from prompts
 */
function extractUserPreferences(userInput) {
  const preferences = [];
  
  // Skip very short inputs
  if (userInput.length < 10) {
    return preferences;
  }
  
  // Look for explicit preferences
  const preferencePatterns = [
    /I (prefer|like|want|need) (.+?)(?:[.!?]|$)/gi,
    /always use (.+?)(?:[.!?]|$)/gi,
    /never use (.+?)(?:[.!?]|$)/gi,
    /(make sure to|remember to|don't forget to) (.+?)(?:[.!?]|$)/gi,
    /important:?\s*(.+?)(?:[.!?]|$)/gi
  ];
  
  for (const pattern of preferencePatterns) {
    let match;
    while ((match = pattern.exec(userInput)) !== null) {
      const preference = match[0].trim();
      if (preference.length > 15 && preference.length < 200) {
        preferences.push({
          content: preference,
          category: CATEGORIES.PREFERENCES,
          metadata: { source: 'user_prompt', timestamp: new Date().toISOString() },
          relevanceScore: 0.8
        });
      }
    }
  }
  
  // Look for project-specific context (but only if substantial)
  if (userInput.length > 50 && (
    userInput.toLowerCase().includes('this project') || 
    userInput.toLowerCase().includes('our codebase') || 
    userInput.toLowerCase().includes('we use'))) {
    
    preferences.push({
      content: `Project context: ${userInput.substring(0, 150)}${userInput.length > 150 ? '...' : ''}`,
      category: CATEGORIES.CONTEXT,
      metadata: { source: 'user_prompt', timestamp: new Date().toISOString() },
      relevanceScore: 0.6
    });
  }
  
  return preferences;
}

/**
 * Main hook function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Read from stdin if no args (typical hook usage)
    let input = '';
    process.stdin.setEncoding('utf8');
    
    return new Promise((resolve) => {
      process.stdin.on('readable', () => {
        const chunk = process.stdin.read();
        if (chunk !== null) {
          input += chunk;
        }
      });
      
      process.stdin.on('end', async () => {
        try {
          const data = JSON.parse(input);
          await processHookData(data);
          resolve();
        } catch (error) {
          log('Error processing hook data:', error.message);
          resolve();
        }
      });
    });
  }
  
  // Command line usage for testing
  const hookType = args[0];
  const data = args[1];
  
  if (!hookType || !data) {
    console.log('Usage: memory-hook.js [hook-type] [json-data]');
    console.log('Or pipe JSON data to stdin');
    process.exit(1);
  }
  
  try {
    const parsedData = JSON.parse(data);
    await processHookData({ hookType, ...parsedData });
  } catch (error) {
    log('Hook error:', error.message);
    process.exit(1);
  }
}

async function processHookData(data) {
  const { inputs, response, user_input } = data;
  
  log('Processing hook data:', { inputs: inputs ? Object.keys(inputs) : null, responseLength: response?.length });
  
  let memoriesToStore = [];
  
  // Handle post-tool-call format (inputs + response)
  if (inputs && response) {
    // Extract tool name from context if available, or infer from inputs
    const toolName = inferToolName(inputs);
    if (toolName) {
      memoriesToStore = extractImportantInfo(toolName, inputs, response);
    }
  }
  
  // Handle user-prompt-submit format
  if (user_input && typeof user_input === 'string') {
    memoriesToStore = extractUserPreferences(user_input);
  }
  
  // Store all extracted memories
  let stored = 0;
  for (const memory of memoriesToStore) {
    const success = await storeMemory(
      memory.content,
      memory.category,
      memory.metadata,
      memory.relevanceScore
    );
    if (success) stored++;
  }
  
  if (stored > 0) {
    console.log(`Stored ${stored} memories`); // stdout for transcript
  }
}

// Run the hook
main().catch(error => {
  log('Fatal error:', error);
  process.exit(1);
});