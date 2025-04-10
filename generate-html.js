#!/usr/bin/env node

const protobuf = require('protobufjs');
const base32 = require('hi-base32');
const url = require('url');
const fs = require('fs');
const qrcode = require('qrcode');
const path = require('path');

// Define the Protocol Buffer schema based on the documentation
const protoDefinition = `
syntax = "proto3";

message Payload {
  message OtpParameters {
    enum Algorithm {
      ALGORITHM_UNSPECIFIED = 0;
      ALGORITHM_SHA1 = 1;
      ALGORITHM_SHA256 = 2;
      ALGORITHM_SHA512 = 3;
      ALGORITHM_MD5 = 4;
    }
    enum DigitCount {
      DIGIT_COUNT_UNSPECIFIED = 0;
      DIGIT_COUNT_SIX = 1;
      DIGIT_COUNT_EIGHT = 2;
    }
    enum OtpType {
      OTP_TYPE_UNSPECIFIED = 0;
      OTP_TYPE_HOTP = 1;
      OTP_TYPE_TOTP = 2;
    }
    bytes secret = 1;
    string name = 2;
    string issuer = 3;
    Algorithm algorithm = 4;
    DigitCount digits = 5;
    OtpType type = 6;
    uint64 counter = 7;
  }
  repeated OtpParameters otp_parameters = 1;
  int32 version = 2;
  int32 batch_size = 3;
  int32 batch_index = 4;
  int32 batch_id = 5;
}
`;

// Algorithm names mapping
const algorithmNames = {
    ALGORITHM_UNSPECIFIED: 'SHA1',  // default
    ALGORITHM_SHA1: 'SHA1',
    ALGORITHM_SHA256: 'SHA256',
    ALGORITHM_SHA512: 'SHA512',
    ALGORITHM_MD5: 'MD5'
};

// Digit counts mapping
const digitCounts = {
    DIGIT_COUNT_UNSPECIFIED: '6',  // default
    DIGIT_COUNT_SIX: '6',
    DIGIT_COUNT_EIGHT: '8'
};

// OTP types mapping
const otpTypes = {
    OTP_TYPE_UNSPECIFIED: 'totp',  // default
    OTP_TYPE_HOTP: 'hotp',
    OTP_TYPE_TOTP: 'totp'
};

/**
 * Extract and decode the 'data' parameter from a Google Authenticator migration URL
 * @param {string} migrationUrl - The otpauth-migration URL
 * @returns {Buffer} - The decoded data buffer
 */
function extractDataFromUrl(migrationUrl) {
  const parsedUrl = url.parse(migrationUrl, true);
  
  if (parsedUrl.protocol !== 'otpauth-migration:' || parsedUrl.host !== 'offline') {
    throw new Error('Invalid Google Authenticator migration URL');
  }
  
  let data = parsedUrl.query.data || '';
  
  // Replace spaces with + (URL encoding artifact)
  data = data.replace(/ /g, '+');
  
  // Decode the base64 data
  return Buffer.from(data, 'base64');
}

/**
 * Create a standard otpauth URL from the OTP parameters
 * @param {object} params - The OTP parameters from the protobuf
 * @returns {string} - A standard otpauth URL
 */
function createOtpauthUrl(params) {
    // Start with the base URL
    let otpType = otpTypes[params.type];
    let path = encodeURIComponent(params.name);
    let result = `otpauth://${otpType}/${path}?`;
    
    // Add the required parameters
    let queryParams = [];
    queryParams.push(`secret=${secretToBase32(params.secret)}`);
    
    // Add issuer if present
    if (params.issuer) {
      queryParams.push(`issuer=${encodeURIComponent(params.issuer)}`);
    }
    
    // Add algorithm if not default
    const algo = algorithmNames[params.algorithm];
    queryParams.push(`algorithm=${algo}`);
    
    // Add digits if not default
    const digits = digitCounts[params.digits];
    queryParams.push(`digits=${digits}`);
    
    // Add counter for HOTP
    if (otpType === 'hotp' && params.counter) {
      queryParams.push(`counter=${params.counter}`);
    }
    
    // Add period for TOTP (default is 30 seconds)
    if (otpType === 'totp') {
      queryParams.push('period=30');
    }
    
    result += queryParams.join('&');
    return result;
}

/**
 * Convert a binary secret to a base32 string (RFC 4648)
 * @param {Buffer} secretBytes - The binary secret
 * @returns {string} - The base32 encoded secret
 */
function secretToBase32(secretBytes) {
  return base32.encode(secretBytes).replace(/=/g, '');
}

/**
 * Decode the Google Authenticator migration data and return account data
 * @param {string} migrationUrl - The otpauth-migration URL
 * @returns {Array} - Array of OTP parameters
 */
async function decodeUrl(migrationUrl) {
  try {
    // Extract and decode the data
    const data = extractDataFromUrl(migrationUrl);
    
    // Load the protobuf definition
    const root = protobuf.parse(protoDefinition).root;
    const Payload = root.lookupType('Payload');
    
    // Decode the protobuf message
    const message = Payload.decode(data);
    const payload = Payload.toObject(message, {
      longs: String,
      enums: String,
      bytes: Buffer,
    });
    
    return payload.otpParameters.map(params => {
      const otpauthUrl = createOtpauthUrl(params);
      return {
        name: params.name,
        issuer: params.issuer,
        secret: Buffer.from(params.secret).toString('hex'),
        type: params.type,
        algorithm: params.algorithm,
        digits: params.digits,
        otpauthUrl: otpauthUrl
      };
    });
    
  } catch (error) {
    console.error('Error decoding migration data:', error);
    return [];
  }
}

/**
 * Generate QR code data URLs for each otpauth URL
 * @param {Array} accounts - Array of account objects with otpauthUrl property
 * @returns {Promise<Array>} - Array of accounts with qrCodeDataUrl added
 */
async function generateQRCodes(accounts) {
  // Generate QR codes for each account
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    // Generate QR code as data URL
    account.qrCodeDataUrl = await qrcode.toDataURL(account.otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      scale: 5
    });
  }
  
  return accounts;
}

/**
 * Generate HTML content for the accounts table
 * @param {Array} accounts - Array of account objects
 * @returns {string} - HTML content
 */
function generateHtml(accounts) {
  const rows = accounts.map(account => {
    return `
    <tr>
      <td>${account.name || '-'}</td>
      <td>${account.issuer || '-'}</td>
      <td>${account.secret}</td>
      <td>${account.type}</td>
      <td>${account.algorithm}</td>
      <td>${account.digits}</td>
      <td><a href="${account.otpauthUrl}" target="_blank">${account.otpauthUrl}</a></td>
      <td><img src="${account.qrCodeDataUrl}" alt="QR Code" width="100" height="100"></td>
    </tr>`;
  }).join('');
  
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OTP Accounts</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        margin: 20px;
        background-color: #f5f5f5;
      }
      h1 {
        color: #333;
        text-align: center;
      }
      table {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
        margin-top: 20px;
        background-color: white;
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
      }
      th, td {
        border: 1px solid #ddd;
        padding: 10px;
        text-align: left;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      th {
        background-color: #4CAF50;
        color: white;
        position: sticky;
        top: 0;
      }
      tr:nth-child(even) {
        background-color: #f2f2f2;
      }
      tr:hover {
        background-color: #ddd;
      }
      .summary {
        margin-top: 20px;
        font-weight: bold;
        text-align: center;
      }
      a {
        color: #2196F3;
        text-decoration: none;
        word-break: break-all;
      }
      a:hover {
        text-decoration: underline;
      }
      /* Set specific widths for columns */
      th:nth-child(1), td:nth-child(1) { width: 12%; } /* Name */
      th:nth-child(2), td:nth-child(2) { width: 10%; } /* Issuer */
      th:nth-child(3), td:nth-child(3) { width: 34%; } /* Secret */
      th:nth-child(4), td:nth-child(4) { width: 8%; } /* Type */
      th:nth-child(5), td:nth-child(5) { width: 8%; } /* Algorithm */
      th:nth-child(6), td:nth-child(6) { width: 8%; } /* Digits */
      th:nth-child(7), td:nth-child(7) { width: 15%; } /* OTP Auth URL */
      th:nth-child(8), td:nth-child(8) { width: 5%; } /* QR Code */
    </style>
  </head>
  <body>
    <h1>OTP Accounts</h1>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Issuer</th>
          <th>Secret</th>
          <th>Type</th>
          <th>Algorithm</th>
          <th>Digits</th>
          <th>OTP Auth URL</th>
          <th>QR Code</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    <div class="summary">Total accounts: ${accounts.length}</div>
  </body>
  </html>
  `;
}

/**
 * Process multiple migration URLs and generate an HTML file
 * @param {Array} migrationUrls - Array of otpauth-migration URLs
 */
async function processAllUrls(migrationUrls) {
  try {
    // Collect all accounts from all URLs
    const allAccountsPromises = migrationUrls.map(url => decodeUrl(url));
    const allAccountsArrays = await Promise.all(allAccountsPromises);
    const allAccounts = allAccountsArrays.flat();
    
    if (allAccounts.length === 0) {
      console.log('No valid accounts found.');
      return;
    }
    
    // Generate QR codes for each account as data URLs
    const accountsWithQR = await generateQRCodes(allAccounts);
    
    // Generate HTML content
    const htmlContent = generateHtml(accountsWithQR);
    
    // Write HTML to file
    const outputPath = path.join(__dirname, 'otp_accounts.html');
    fs.writeFileSync(outputPath, htmlContent);
    
    console.log(`HTML file generated: ${outputPath}`);
    console.log(`Total accounts: ${allAccounts.length}`);
    
  } catch (error) {
    console.error('Error processing URLs:', error);
  }
}

// Get all URLs from command-line arguments (skip the first two: node and script name)
const migrationUrls = process.argv.slice(2);
if (migrationUrls.length === 0) {
  console.log('Usage: node generate-html.js "otpauth-migration://offline?data=..." ["otpauth-migration://offline?data=..." ...]');
  process.exit(1);
}

// Process all provided URLs
processAllUrls(migrationUrls); 