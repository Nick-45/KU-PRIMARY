const { setGlobalOptions } = require('firebase-functions/v2');
setGlobalOptions({ region: 'europe-west1', maxInstances: 20 });

// Triggers
exports.onFeeTransactionWrite = require('./triggers/onFeeTransactionWrite').onFeeTransactionWrite;
exports.onInvoiceWrite = require('./triggers/onInvoiceWrite').onInvoiceWrite;

// Scheduled
exports.overdueInvoices = require('./scheduled/overdueInvoices').overdueInvoices;
exports.agingReport = require('./scheduled/agingReport').agingReport;
exports.sendReminders = require('./scheduled/sendReminders').sendReminders;
exports.termRollover = require('./scheduled/termRollover').termRollover;

// Callable
exports.bulkInvoiceCreate = require('./callable/bulkInvoiceCreate').bulkInvoiceCreate;
exports.bulkFeeEntry = require('./callable/bulkFeeEntry').bulkFeeEntry;
exports.voidTransaction = require('./callable/voidTransaction').voidTransaction;

// HTTP
exports.mpesaStkPush = require('./http/mpesaStkPush').mpesaStkPush;
exports.mpesaCallback = require('./http/mpesaCallback').mpesaCallback;
exports.sendInvoiceReminder = require('./http/sendInvoiceReminder').sendInvoiceReminder;
