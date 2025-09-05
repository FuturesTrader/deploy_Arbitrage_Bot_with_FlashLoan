// src/logger.js
const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');
const process = require('process');
const dotenv = require('dotenv');
dotenv.config();

// Simple safe serialization function (avoiding circular references)
const safeSerialize = function(obj, indent = 2) {
    const seen = new WeakSet();
    return JSON.stringify(
        obj,
        (key, value) => {
            if (typeof value === 'bigint') {
                return value.toString();
            }
            if (value instanceof Error) {
                const error = {
                    name: value.name,
                    message: value.message,
                    stack: value.stack
                };
                Object.getOwnPropertyNames(value).forEach((prop) => {
                    if (!error[prop]) {
                        error[prop] = value[prop];
                    }
                });
                return error;
            }
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) {
                    return '[Circular]';
                }
                seen.add(value);
            }
            switch (typeof value) {
                case 'undefined':
                    return 'undefined';
                case 'function':
                    return `[Function: ${value.name || 'anonymous'}]`;
                case 'symbol':
                    return value.toString();
                default:
                    return value;
            }
        },
        indent
    );
};

class LoggerSingleton {
    static instance = null;
    static isInitialized = false;

    static getLogsDirectory() {
        const cwd = process.cwd();
        const logsDir = path.join(cwd, 'logs');

        if (!fs.existsSync(logsDir)) {
            try {
                fs.mkdirSync(logsDir, { recursive: true });
                console.log(`Created logs directory at: ${logsDir}`);
            } catch (error) {
                console.error(`Failed to create logs directory at ${logsDir}:`, error);
                process.exit(1);
            }
        }
        return logsDir;
    }

    static createFormat() {
        return winston.format.combine(
            winston.format.timestamp({
                format: () => {
                    const now = new Date();
                    // Format date as YYYY-MM-DD using en-CA (ISO-like)
                    const datePart = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
                    // Format time as HH:mm:ss (24-hour clock) using en-GB
                    const timePart = now.toLocaleTimeString('en-GB', {
                        timeZone: 'America/Chicago',
                        hour12: false,
                    });
                    // Extract the timezone abbreviation (e.g. CST or CDT)
                    const tzString = now
                        .toLocaleTimeString('en-US', {
                            timeZone: 'America/Chicago',
                            timeZoneName: 'short',
                        })
                        .split(' ')
                        .pop();
                    return `${datePart}T${timePart}.000 ${tzString}`;
                },
            }),
            winston.format.printf(({ level, message, timestamp, ...metadata }) => {
                let serializedMetadata = '';
                if (metadata && Object.keys(metadata).length > 0) {
                    try {
                        serializedMetadata = safeSerialize(metadata);
                    } catch (error) {
                        serializedMetadata = `[Serialization Error: ${
                            error instanceof Error ? error.message : String(error)
                        }]`;
                        console.error('Logging serialization error:', error);
                    }
                }
                return `${timestamp} [${level}]: ${message} ${serializedMetadata}`;
            })
        );
    }

    static getInstance() {
        if (!LoggerSingleton.instance) {
            LoggerSingleton.initialize();
        }
        return LoggerSingleton.instance;
    }

    static initialize() {
        if (LoggerSingleton.isInitialized) {
            return;
        }

        const logsDir = LoggerSingleton.getLogsDirectory();
        const customFormat = LoggerSingleton.createFormat();

        // Console transport with debug level for development
        const consoleTransport = new winston.transports.Console({
            level: 'debug',
            format: winston.format.combine(winston.format.colorize(), customFormat),
        });

        // File transport with configurable level and reduced size
        const fileTransport = new winston.transports.DailyRotateFile({
            filename: path.join(logsDir, 'application-%DATE%.log'),
            datePattern: 'YYYY-MM-DD',
            maxSize: '100k', // Reduced to 100KB
            maxFiles: '2d', // Reduced retention period to manage storage
            level: process.env.LOG_LEVEL || 'debug',
            format: customFormat,
            handleExceptions: true,
            handleRejections: true,
            zippedArchive: true
        });

        // Create the logger
        const baseLogger = winston.createLogger({
            level: process.env.LOG_LEVEL || 'debug',
            format: winston.format.combine(
                winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
                customFormat
            ),
            transports: [consoleTransport, fileTransport],
            exitOnError: false
        });

        // Add flush capability
        baseLogger.flush = async function() {
            return new Promise((resolve) => {
                const transports = this.transports;
                const promises = transports.map(
                    transport =>
                        new Promise(transportResolve => {
                            if (transport instanceof winston.transports.DailyRotateFile) {
                                setTimeout(() => transportResolve(), 100);
                                if (typeof transport.close === 'function') {
                                    transport.on('finish', () => transportResolve());
                                } else {
                                    transportResolve();
                                }
                            } else {
                                transportResolve();
                            }
                        })
                );

                Promise.all(promises).then(() => {
                    setTimeout(resolve, 100);
                });
            });
        };

        // Error handling
        fileTransport.on('error', (error) => {
            console.error('File transport error:', error);
        });

        consoleTransport.on('error', (error) => {
            console.error('Console transport error:', error);
        });

        LoggerSingleton.instance = baseLogger;
        LoggerSingleton.isInitialized = true;

        // Initial log to verify logger is working
        baseLogger.info('Logger initialized', {
            logsDirectory: logsDir,
            logLevel: process.env.LOG_LEVEL || 'debug',
            nodeEnv: process.env.NODE_ENV,
            timezone: 'America/Chicago'
        });
    }
}

// Export the singleton instance
const logger = LoggerSingleton.getInstance();

// Ensure the trade logs subdirectory exists
const tradeLogsDir = path.join(LoggerSingleton.getLogsDirectory(), 'tradelogs');
if (!fs.existsSync(tradeLogsDir)) {
    try {
        fs.mkdirSync(tradeLogsDir, { recursive: true });
        console.log(`Created trade logs directory at: ${tradeLogsDir}`);
    } catch (error) {
        console.error(`Failed to create trade logs directory at ${tradeLogsDir}:`, error);
        process.exit(1);
    }
}

const tradeTransport = new winston.transports.DailyRotateFile({
    filename: path.join(tradeLogsDir, 'trade-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '100k', // Reduced to 100KB
    maxFiles: '14d', // Reduced retention period to manage storage
    level: 'info',
    format: LoggerSingleton.createFormat(),
    zippedArchive: true
});

const tradeLogger = winston.createLogger({
    level: 'info',
    transports: [tradeTransport]
});

module.exports = logger;
module.exports.tradeLogger = tradeLogger;