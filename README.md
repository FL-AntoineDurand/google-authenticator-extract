# Google Authenticator Migration Decoder

This tool decodes the QR code data exported from the Google Authenticator app and displays the accounts in a readable format.

## Installation

```bash
# Clone the repository or download the files
# Then install dependencies
npm install
```

## Usage


### HTML Output with QR Codes

To generate an HTML page with a table of accounts, including OTP Auth URLs and QR codes:

```bash
# On Linux/Mac/Windows
node generate-html.js "otpauth-migration://offline?data=YOUR_MIGRATION_DATA"
```

This will generate an HTML file (`otp_accounts.html`) with all your accounts

Replace `YOUR_MIGRATION_DATA` with the data from your Google Authenticator QR code.

## How to Export from Google Authenticator

1. Open Google Authenticator app
2. Tap the three dots in the top right corner
3. Select "Transfer accounts" or "Export accounts"
4. Select the accounts you want to export
5. Scan the generated QR code with a QR code reader app
6. Copy the URL from the QR code (starts with `otpauth-migration://offline?data=`)

# KeyPass

## Import

1. edit a keypass entry
2. go to advnaced tab
3. create a new string field neamed 'TimeOtp-Secret-Hex'
4. copy the secret's hex value from html table output (column 'secret')
5. check 'Protect value in process memory' option

## Display TOTP code in KeyPass
1. right-click KeyPass entry,
2. Go to 'Other Data' -> 'Copy Time-Based OTP'

## to use it in auto-type sequence

use the value variable name {TIMEOTP} in 'Auto-Type' tabs --> 'Override default sequence'

example for AWS login page

```
YourUsername{TAB}{PASSWORD}{ENTER}{DELAY 3000}{TIMEOTP}{ENTER}
```
