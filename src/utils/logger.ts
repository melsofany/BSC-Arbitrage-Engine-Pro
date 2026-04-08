import winston from 'winston';

// Create a winston logger instance
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
        // Custom format to mask sensitive data
        winston.format((info) => {
            // Mask common sensitive data patterns
            if (info.message) {
                info.message = info.message.replace(/token=[^&]*/g, 'token=****');
                info.message = info.message.replace(/privateKey=[^&]*/g, 'privateKey=****');
                info.message = info.message.replace(/address=[^&]*/g, 'address=****');
            }
            return info;
        })()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'combined.log' })
    ],
});

export const logInfo = (message) => {
    logger.info(message);
};

export const logError = (message) => {
    logger.error(message);
};

export const logDebug = (message) => {
    logger.debug(message);
};