Bigisub API
v2.0.0
Digital services marketplace, telecom, bills payment, and marketing APIs. 43 endpoints across 11 service categories.

Authentication: Create an account on bigisub.ng, login with your credentials to get your token, then use Authorization: Token <your_token> on all requests.
Base URL: https://api.bigisub.ng

Authentication
1
Airtime
1
Data
2
Cable TV
4
Recharge Pin
2
Electricity
3
Education
3
ISP
5
Betting
6
SMS
4
Marketing Hub
22
Transaction Status
2
One-time setup
→
POST /api/v2/auth/login/ → get your permanent API token
The `token` field in the response is your permanent API key - it never expires.

Use it in all requests as: Authorization: Token <your_token>

The `access` and `refresh` JWT tokens are for the mobile app only - ignore them for API integrations.

POST
/auth/login/
POST
/api/v2/auth/login/
Login to obtain tokens

Request Body
{
"email_or_username": "partner@example.com",
"password": "securepassword"
}
Try in Console
Copy cURL
Common Fields
Field
Used In
Description
pin / pin_code
All purchases
Your 4-digit Bigisub transaction PIN
phone_number
VTU, electricity
Nigerian phone (08x format, 11 digits)
plan
Data, recharge pin, ISP
The `id` from the corresponding plans endpoint
service_id
Marketing Hub
The `id` from the services list
order_id
Marketing Hub
The `order_id` from the order create response
job_id
SMS
The `job_id` from the SMS send response

Authentication
1
Airtime
1
Data
2
Cable TV
4
Recharge Pin
2
Electricity
3
Education
3
ISP
5
Betting
6
SMS
4
Marketing Hub
22
Transaction Status
2
Single endpoint - no prerequisites
→
POST /api/v2/vtu/airtime/purchase/
Network IDs

1
MTN
2
GLO
3
AIRTEL
4
9MOBILE
Minimum amount: ₦25

`pin` is your 4-digit transaction PIN set in your Bigisub account

POST
/vtu/airtime/purchase/
POST
/api/v2/vtu/airtime/purchase/
Purchase airtime

Request Body
{
"network": 1,
"phone_number": "08012345678",
"amount": "100",
"airtime_type": "vtu",
"pin": "1234"
}
Response
{
"success": true,
"data": {
"transaction_id": "AirQVfafs4b3f2",
"reference": "202604101309hlpS",
"status": "successful",
"amount": "100",
"phone_number": "08012345678",
"network": "mtn",
"timestamp": "2026-04-10T13:09:29.577408"
},
"message": "Airtime purchase successful"
}
Try in Console
Copy cURL
Common Fields
Field
Used In
Description
pin / pin_code
All purchases
Your 4-digit Bigisub transaction PIN
phone_number
VTU, electricity
Nigerian phone (08x format, 11 digits)
plan
Data, recharge pin, ISP
The `id` from the corresponding plans endpoint
service_id
Marketing Hub
The `id` from the services list
order_id
Marketing Hub
The `order_id` from the order create response
job_id
SMS
The `job_id` from the SMS send response

hentication
1
Airtime
1
Data
2
Cable TV
4
Recharge Pin
2
Electricity
3
Education
3
ISP
5
Betting
6
SMS
4
Marketing Hub
22
Transaction Status
2
Two-step: browse plans → purchase
→
GET /api/v2/vtu/data/plans/ → get plan list
→
POST /api/v2/vtu/data/purchase/ → purchase (plan = id from plans list)
Network IDs

1
MTN
2
GLO
3
AIRTEL
4
9MOBILE
Use `?network=1` to filter MTN only, `?plantype=SME` for SME plans, or combine both.

GET
/vtu/data/plans/

POST
/vtu/data/purchase/
GET
/api/v2/vtu/data/plans/
List available data plans

Response
{
"success": true,
"data": [
{
"id": 135,
"network": 1,
"network_name": "MTN",
"plantype": "SME",
"size": "1.5GB",
"plan_volume": "1536MB",
"validity": "30 days",
"amount": 465,
"plan_amount": 480,
"corporate_amount": 450,
"plan_disabled": false
},
{
"id": 140,
"network": 1,
"network_name": "MTN",
"plantype": "GIFTING",
"size": "3GB",
"plan_volume": "3072MB",
"validity": "30 days",
"amount": 980,
"plan_amount": 1000,
"corporate_amount": 960,
"plan_disabled": false
}
],
"message": "Data plans retrieved successfully"
}
Try in Console
Copy cURL
Common Fields
Field
Used In
Description
pin / pin_code
All purchases
Your 4-digit Bigisub transaction PIN
phone_number
VTU, electricity
Nigerian phone (08x format, 11 digits)
plan
Data, recharge pin, ISP
The `id` from the corresponding plans endpoint
service_id
Marketing Hub
The `id` from the services list
order_id
Marketing Hub
The `order_id` from the order create response
job_id
SMS
The `job_id` from the SMS send response

Bigisub API
v2.0.0
Digital services marketplace, telecom, bills payment, and marketing APIs. 43 endpoints across 11 service categories.

Authentication: Create an account on bigisub.ng, login with your credentials to get your token, then use Authorization: Token <your_token> on all requests.
Base URL: https://api.bigisub.ng

Authentication
1
Airtime
1
Data
2
Cable TV
4
Recharge Pin
2
Electricity
3
Education
3
ISP
5
Betting
6
SMS
4
Marketing Hub
22
Transaction Status
2
Three-step: get plans → verify customer → purchase
→
GET /api/v2/vtu/cable/plans/ → get plans (filter: ?cable_name=dstv)
→
POST /api/v2/vtu/cable/verify/ → verify smartcard, get customer name
→
POST /api/v2/vtu/cable/purchase/ → purchase (Customer = name from verify)
Supported providers: DSTV, GOtv, Startimes, Showmax

Optional: GET /api/v2/vtu/cable/pricing/ for pricing overview

The `Customer` field in purchase must match the name returned from verify.

GET
/vtu/cable/plans/

GET
/vtu/cable/pricing/

POST
/vtu/cable/verify/

POST
/vtu/cable/purchase/
GET
/api/v2/vtu/cable/plans/
List cable TV plans

Response
{
"success": true,
"data": [
{
"id": 1,
"cable_name": "dstv",
"product_name": "DStv Padi",
"variation_code": "dstv-padi",
"amount": 2950
},
{
"id": 2,
"cable_name": "dstv",
"product_name": "DStv Yanga",
"variation_code": "dstv-yanga",
"amount": 5100
},
{
"id": 10,
"cable_name": "gotv",
"product_name": "GOtv Smallie",
"variation_code": "gotv-smallie",
"amount": 1575
}
],
"message": "Cable plans retrieved successfully"
}
Try in Console
Copy cURL
Common Fields
Field
Used In
Description
pin / pin_code
All purchases
Your 4-digit Bigisub transaction PIN
phone_number
VTU, electricity
Nigerian phone (08x format, 11 digits)
plan
Data, recharge pin, ISP
The `id` from the corresponding plans endpoint
service_id
Marketing Hub
The `id` from the services list
order_id
Marketing Hub
The `order_id` from the order create response
job_id
SMS
The `job_id` from the SMS send response

entication
1
Airtime
1
Data
2
Cable TV
4
Recharge Pin
2
Electricity
3
Education
3
ISP
5
Betting
6
SMS
4
Marketing Hub
22
Transaction Status
2
Two-step: browse plans → purchase
→
GET /api/v2/vtu/recharge-pin/plans/ → get denominations
→
POST /api/v2/vtu/recharge-pin/purchase/ → purchase (plan = id from plans list)

GET
/vtu/recharge-pin/plans/

POST
/vtu/recharge-pin/purchase/
GET
/api/v2/vtu/recharge-pin/plans/
List recharge pin plans

Response
{
"success": true,
"data": [
{
"id": 1,
"network": 1,
"network_name": "MTN",
"size": "N100",
"regular_price": 95,
"corporate_price": 90,
"info": "MTN N100 Recharge Pin"
},
{
"id": 2,
"network": 1,
"network_name": "MTN",
"size": "N200",
"regular_price": 190,
"corporate_price": 180,
"info": "MTN N200 Recharge Pin"
}
],
"message": "Recharge pin plans retrieved successfully"
}
Try in Console
Copy cURL
Common Fields
Field
Used In
Description
pin / pin_code
All purchases
Your 4-digit Bigisub transaction PIN
phone_number
VTU, electricity
Nigerian phone (08x format, 11 digits)
plan
Data, recharge pin, ISP
The `id` from the corresponding plans endpoint
service_id
Marketing Hub
The `id` from the services list
order_id
Marketing Hub
The `order_id` from the order create response
job_id
SMS
The `job_id` from the SMS send response

n
1
Airtime
1
Data
2
Cable TV
4
Recharge Pin
2
Electricity
3
Education
3
ISP
5
Betting
6
SMS
4
Marketing Hub
22
Transaction Status
2
Three-step: get providers → verify meter → pay
→
GET /api/v2/bills/electricity/providers/ → get DisCo codes
→
POST /api/v2/bills/electricity/verify/ → verify meter, get customer name
→
POST /api/v2/bills/electricity/pay/ → pay (Customer_name = name from verify)
Response includes `token` (electricity token for prepaid) and `units` (kWh).

GET
/bills/electricity/providers/

POST
/bills/electricity/verify/

POST
/bills/electricity/pay/
GET
/api/v2/bills/electricity/providers/
List electricity providers

Response
{
"success": true,
"data": {
"providers": [
{
"name": "Ikeja Electric (IKEDC)",
"code": "ikeja-electric",
"min_amount": 1000,
"service_charge": 100,
"service_charge_type": "fixed",
"description": "Ikeja Electricity Distribution"
},
{
"name": "Eko Electric (EKEDC)",
"code": "eko-electric",
"min_amount": 1000,
"service_charge": 100,
"service_charge_type": "fixed",
"description": "Eko Electricity Distribution"
}
]
},
"message": "Electricity providers retrieved successfully"
}
Try in Console
Copy cURL
Common Fields
Field
Used In
Description
pin / pin_code
All purchases
Your 4-digit Bigisub transaction PIN
phone_number
VTU, electricity
Nigerian phone (08x format, 11 digits)
plan
Data, recharge pin, ISP
The `id` from the corresponding plans endpoint
service_id
Marketing Hub
The `id` from the services list
order_id
Marketing Hub
The `order_id` from the order create response
job_id
SMS
The `job_id` from the SMS send response

hentication
1
Airtime
1
Data
2
Cable TV
4
Recharge Pin
2
Electricity
3
Education
3
ISP
5
Betting
6
SMS
4
Marketing Hub
22
Transaction Status
2
Two-step: check prices → purchase
→
GET /api/v2/bills/result-checker/prices/ → get exam types and prices
→
POST /api/v2/bills/result-checker/purchase/ → purchase (exam = code from prices)
Alternative: GET /api/v2/bills/education/services/ for all education services

GET
/bills/result-checker/prices/

POST
/bills/result-checker/purchase/

GET
/bills/education/services/
GET
/api/v2/bills/result-checker/prices/
Get exam result checker prices

Response
{
"success": true,
"data": {
"prices": [
{
"exam_type": "WAEC",
"name": "WAEC Result Checker",
"amount": 2500,
"validity": "Valid for current examination year",
"description": "Check WAEC examination results",
"code": "waec"
},
{
"exam_type": "NECO",
"name": "NECO Result Checker",
"amount": 1000,
"validity": "Valid for current examination year",
"description": "Check NECO examination results",
"code": "neco"
}
]
},
"message": "Result checker pricing retrieved successfully"
}
Try in Console
Copy cURL

thentication
1
Airtime
1
Data
2
Cable TV
4
Recharge Pin
2
Electricity
3
Education
3
ISP
5
Betting
6
SMS
4
Marketing Hub
22
Transaction Status
2
Smile (three-step) / Spectranet (two-step)
Smile:

→
GET /api/v2/isp/smile/plans/ → browse plans
→
POST /api/v2/isp/smile/verify/ → verify account
→
POST /api/v2/isp/smile/topup/ → topup (plan = id from plans)
Spectranet:

→
GET /api/v2/isp/spectranet/plans/ → browse plans
→
POST /api/v2/isp/spectranet/topup/ → topup (plan = id from plans)

GET
/isp/smile/plans/

POST
/isp/smile/verify/

POST
/isp/smile/topup/

GET
/isp/spectranet/plans/

POST
/isp/spectranet/topup/
GET
/api/v2/isp/smile/plans/
List Smile ISP plans

Response
{
"success": true,
"data": [
{
"id": 1,
"name": "Smile 1GB",
"plan_volume": "1GB",
"plan_price": 1200,
"validity": "30 days",
"variation_code": "smile-1gb",
"plan_corporate_price": 1100
}
],
"message": "Smile plans retrieved successfully"
}
Try in Console
Copy cURL

uthentication
1
Airtime
1
Data
2
Cable TV
4
Recharge Pin
2
Electricity
3
Education
3
ISP
5
Betting
6
SMS
4
Marketing Hub
22
Transaction Status
2
Four-step: list billers, get products, validate, fund
→
GET /api/v2/betting/billers/ -> list platforms (Bet9ja, SportyBet, etc)
→
GET /api/v2/betting/products/?biller_code=BET9JA -> get products
→
POST /api/v2/betting/validate/ -> validate customer, get validation_reference
→
POST /api/v2/betting/fund/ -> fund wallet (returns transaction_id, status_detail)
Some billers require `validation_reference` from the validate step. Check `requires_validation_ref` in the validate response.

Fund response returns `transaction_id` and `status_detail` (no reference, order_id, or remark).

GET /api/v2/betting/requery/?transaction_id=X to check status (returns transaction_id, biller_name, status_detail)

GET /api/v2/betting/history/ for transaction history

GET
/betting/billers/

GET
/betting/products/

POST
/betting/validate/

POST
/betting/fund/

GET
/betting/requery/

GET
/betting/history/
GET
/api/v2/betting/billers/
List betting billers

Response
{
"success": true,
"data": [
{
"code": "BET9JA",
"name": "Bet9ja",
"min_amount": 100,
"max_amount": 1000000
},
{
"code": "biller-sporty-bet",
"name": "SportyBet",
"min_amount": 100,
"max_amount": 1000000
},
{
"code": "biller-bet-king",
"name": "BetKing",
"min_amount": 100,
"max_amount": 1000000
}
],
"message": "38 betting companies retrieved successfully"
}
Try in Console
Copy cURL
Common Fields
Field
Used In
Description
pin / pin_code
All purchases
Your 4-digit Bigisub transaction PIN
phone_number
VTU, electricity
Nigerian phone (08x format, 11 digits)
plan
Data, recharge pin, ISP
The `id` from the corresponding plans endpoint
service_id
Marketing Hub
The `id` from the services list
order_id
Marketing Hub
The `order_id` from the order create response
job_id
SMS
The `job_id` from the SMS send response

Bigisub API
v2.0.0
Digital services marketplace, telecom, bills payment, and marketing APIs. 43 endpoints across 11 service categories.

Authentication: Create an account on bigisub.ng, login with your credentials to get your token, then use Authorization: Token <your_token> on all requests.
Base URL: https://api.bigisub.ng

Authentication
1
Airtime
1
Data
2
Cable TV
4
Recharge Pin
2
Electricity
3
Education
3
ISP
5
Betting
6
SMS
4
Marketing Hub
22
Transaction Status
2
Send and track
→
GET /api/v2/communications/sms/pricing/ → get cost per page
→
POST /api/v2/communications/sms/send/ → send SMS (max 500 recipients)
→
GET /api/v2/communications/sms/job/{job_id}/status/ → track delivery
→
GET /api/v2/communications/sms/jobs/ → list all jobs
Normal SMS: 160 chars/page, Unicode SMS: 70 chars/page

Cost = cost_per_page × pages × recipients

GET
/communications/sms/pricing/

POST
/communications/sms/send/

GET
/communications/sms/job/{job_id}/status/

GET
/communications/sms/jobs/
GET
/api/v2/communications/sms/pricing/
Get SMS pricing

Response
{
"success": true,
"data": {
"cost_per_page": 5,
"normal_chars_per_page": 160,
"unicode_chars_per_page": 70
},
"message": "SMS pricing retrieved successfully"
}
Try in Console
Copy cURL
Common Fields
Field
Used In
Description
pin / pin_code
All purchases
Your 4-digit Bigisub transaction PIN
phone_number
VTU, electricity
Nigerian phone (08x format, 11 digits)
plan
Data, recharge pin, ISP
The `id` from the corresponding plans endpoint
service_id
Marketing Hub
The `id` from the services list
order_id
Marketing Hub
The `order_id` from the order create response
job_id
SMS
The `job_id` from the SMS send response

Check the prices of our services
Airtime
Print Airtime
Data
Cable TV
Electricity
Bulk SMS
Result Checker
Internet
Marketing Hub
Betting
Instant Airtime Purchase
All Networks • Instant Delivery

1% - 4% Discount
Discount varies by user type and volume

Available Networks:
MTN, Glo, Airtel, 9mobile
Minimum Amount:
₦50
Maximum Amount:
₦50,000
Delivery Time:
Instant

Recharge Card Printing (ePIN)
Print airtime cards for all networks

MTN
Pin Value Regular Corporate
₦100 ₦99.8 ₦98.9
₦200 ₦199.6 ₦197.8
₦500 ₦499 ₦494.5
₦1,000 ₦998 ₦989
Glo
Pin Value Regular Corporate
₦100 ₦99.6 ₦98.5
₦200 ₦199.2 ₦197
₦500 ₦498 ₦492.5
Airtel
Pin Value Regular Corporate
₦100 ₦99.6 ₦98.5
₦200 ₦199.2 ₦197
₦500 ₦498 ₦492.5
9Mobile
Pin Value Regular Corporate
₦100 ₦99.6 ₦98.5
₦200 ₦199.2 ₦197
Print 1-10 cards per transaction. Custom business name on each card. A4 printer compatible.

Regular User
Corporate User
20MB

- ₦25
  (GIFTING)
  20MB
- ₦25
  (GIFTING)
  200MB
- ₦99
  (GIFTING)
  1GB
- ₦268
  (CGIFTING)
  1GB
- ₦269
  (GIFTING)
  1GB
- ₦275
  (CGIFTING)
  1GB
- ₦285
  (SME2)
  1GB
- ₦300
  (GIFTING)
  1GB
- ₦305
  (GIFTING)
  1GB
- ₦310
  (SME2)
  500MB
- ₦355
  (DataTransfer)
  1GB
- ₦425
  (DataTransfer)
  1GB
- ₦435
  (SME)
  1GB
- ₦480
  (DataTransfer)
  500MB
- ₦489
  (GIFTING)
  1GB
- ₦493
  (GIFTING)
  500MB
- ₦495
  (DataTransfer)
  1.2GB
- ₦499
  (GIFTING)
  1GB
- ₦510
  (SME)
  2GB
- ₦522
  (CGIFTING)
  2GB
- ₦525
  (CGIFTING)
  1GB
- ₦635
  (SME2)
  1.5GB
- ₦640
  (GIFTING)
  1GB
- ₦640
  (SME)
  2.5GB
- ₦645
  (GIFTING)
  1GB
- ₦650
  (SME2)
  1GB
- ₦650
  (DataTransfer)
  1.5GB
- ₦700
  (GIFTING)
  2.5GB
- ₦750
  (GIFTING)
  3GB
- ₦773
  (CGIFTING)
  3GB
- ₦790
  (CGIFTING)
  1.2GB
- ₦820
  (GIFTING)
  4.5GB
- ₦995
  (GIFTING)
  4GB
- ₦1,100
  (GIFTING)
  2GB
- ₦1,160
  (SME)
  2GB
- ₦1,180
  (DataTransfer)
  5GB
- ₦1,275
  (CGIFTING)
  5GB
- ₦1,285
  (CGIFTING)
  5GB
- ₦1,400
  (GIFTING)
  2GB
- ₦1,495
  (GIFTING)
  3.5GB
- ₦1,499
  (GIFTING)
  3GB
- ₦1,720
  (SME)
  3GB
- ₦1,750
  (DataTransfer)
  2.7GB
- ₦1,985
  (GIFTING)
  8GB
- ₦1,990
  (GIFTING)
  5GB
- ₦2,100
  (DataTransfer)
  5GB
- ₦2,200
  (SME)
  3.5GB
- ₦2,487
  (GIFTING)
  10GB
- ₦2,550
  (CGIFTING)
  11GB
- ₦3,488
  (GIFTING)
  7GB
- ₦3,500
  (GIFTING)
  10GB
- ₦3,800
  (GIFTING)
  15GB
- ₦3,990
  (GIFTING)
  12.5GB
- ₦4,450
  (GIFTING)
  10GB
- ₦4,466
  (GIFTING)
  12.5GB
- ₦5,460
  (GIFTING)
  18GB
- ₦5,975
  (GIFTING)
  16.5GB
- ₦6,460
  (GIFTING)
  20GB
- ₦7,455
  (GIFTING)
  28GB
- ₦7,940
  (GIFTING)
  25GB
- ₦8,950
  (GIFTING)
  40GB
- ₦9,920
  (GIFTING)
  36GB
- ₦10,940
  (GIFTING)
  60GB
- ₦14,400
  (GIFTING)
  65GB
- ₦15,915
  (GIFTING)
  75GB
- ₦17,885
  (GIFTING)
  165GB
- ₦34,785
  (GIFTING)
  150GB
- ₦39,500
  (GIFTING)
  200GB
- ₦49,770
  (GIFTING)
  250GB
- ₦54,760
  (GIFTING)
  800GB
- ₦123,999
  (GIFTING)
  GLO logo
  Regular User
  Corporate User
  45MB
- ₦49
  (SME)
  40MB
- ₦50
  (DataTransfer)
  200MB
- ₦95
  (CGIFTING)
  125MB
- ₦98
  (SME)
  750MB
- ₦120
  (SME)
  275MB
- ₦198
  (SME)
  260MB
- ₦198
  (GIFTING)
  875MB
- ₦210
  (SME)
  500MB
- ₦223
  (CGIFTING)
  1GB
- ₦245
  (SME)
  1GB
- ₦299
  (DataTransfer)
  1GB
- ₦300
  (DataTransfer)
  1GB
- ₦330
  (CGIFTING)
  1GB
- ₦350
  (CGIFTING)
  1.5GB
- ₦350
  (SME)
  1GB
- ₦375
  (CGIFTING)
  1.024GB
- ₦445
  (CGIFTING)
  2.5GB
- ₦499
  (GIFTING)
  1.5GB
- ₦499
  (DataTransfer)
  3GB
- ₦695
  (SME)
  3.75GB
- ₦745
  (SME)
  2GB
- ₦890
  (CGIFTING)
  3.9GB
- ₦990
  (GIFTING)
  2.6GB
- ₦995
  (DataTransfer)
  3.7GB
- ₦1,230
  (GIFTING)
  6GB
- ₦1,293
  (SME)
  3.072GB
- ₦1,335
  (CGIFTING)
  6GB
- ₦1,490
  (DataTransfer)
  5GB
- ₦1,490
  (DataTransfer)
  6.15GB
- ₦1,940
  (GIFTING)
  6.25GB
- ₦1,990
  (DataTransfer)
  5.12GB
- ₦2,225
  (CGIFTING)
  9.8GB
- ₦2,370
  (SME)
  7.25GB
- ₦2,398
  (GIFTING)
  10.8GB
- ₦2,890
  (GIFTING)
  12.5GB
- ₦3,845
  (GIFTING)
  14GB
- ₦3,985
  (DataTransfer)
  10.8GB
- ₦4,450
  (CGIFTING)
  16GB
- ₦4,770
  (GIFTING)
  18GB
- ₦4,960
  (DataTransfer)
  28GB
- ₦7,650
  (GIFTING)
  29GB
- ₦7,950
  (DataTransfer)
  38GB
- ₦9,590
  (GIFTING)
  40GB
- ₦9,900
  (DataTransfer)
  64GB
- ₦14,590
  (GIFTING)
  107GB
- ₦19,670
  (GIFTING)
  Airtel logo
  Regular User
  Corporate User
  75MB
- ₦75
  (GIFTING)
  200MB
- ₦99
  (GIFTING)
  300MB
- ₦290
  (GIFTING)
  1.5GB
- ₦475
  (SME)
  1.5GB
- ₦500
  (GIFTING)
  2GB
- ₦600
  (GIFTING)
  2GB
- ₦760
  (GIFTING)
  1GB
- ₦786
  (GIFTING)
  4GB
- ₦999
  (GIFTING)
  2GB
- ₦1,475
  (GIFTING)
  3.5GB
- ₦1,490
  (GIFTING)
  6GB
- ₦1,499
  (GIFTING)
  4GB
- ₦1,505
  (GIFTING)
  3GB
- ₦1,970
  (GIFTING)
  6GB
- ₦1,988
  (GIFTING)
  8GB
- ₦2,485
  (GIFTING)
  4GB
- ₦2,485
  (GIFTING)
  10GB
- ₦3,010
  (GIFTING)
  8GB
- ₦3,010
  (GIFTING)
  10GB
- ₦3,450
  (SME)
  10GB
- ₦3,980
  (GIFTING)
  13GB
- ₦5,525
  (SME)
  18GB
- ₦5,950
  (GIFTING)
  25GB
- ₦7,950
  (GIFTING)
  35GB
- ₦9,930
  (GIFTING)
  35GB
- ₦11,645
  (SME)
  60GB
- ₦14,850
  (GIFTING)
  60GB
- ₦14,970
  (SME)
  100GB
- ₦19,900
  (GIFTING)
  160GB
- ₦29,890
  (GIFTING)
  210GB
- ₦39,600
  (GIFTING)
  300GB
- ₦49,400
  (GIFTING)
  350GB
- ₦59,000
  (GIFTING)
  680GB
- ₦98,900
  (GIFTING)
  9Mobile logo
  Regular User
  Corporate User
  40MB
- ₦49
  (DataTransfer)
  83MB
- ₦99
  (DataTransfer)
  150MB
- ₦148
  (DataTransfer)
  250MB
- ₦197
  (DataTransfer)
  650MB
- ₦494
  (DataTransfer)
  2GB
- ₦990
  (DataTransfer)
  2.3GB
- ₦1,190
  (DataTransfer)
  4.5GB
- ₦1,985
  (DataTransfer)
  5.2GB
- ₦2,477
  (DataTransfer)
  6.2GB
- ₦2,972
  (DataTransfer)
  8.4GB
- ₦3,964
  (DataTransfer)
  11.4GB
- ₦4,964
  (DataTransfer)
  Data Prices and Service Rates - All Networks Nigeria
  Bigisub.ng offers the cheapest data prices in Nigeria across all major networks - MTN, Glo, Airtel, and 9mobile. Our wholesale pricing structure means you always pay less than retail rates, whether you are buying for personal use or reselling to earn profit. Prices are updated daily to reflect the latest rates from all networks.

MTN Data Prices: MTN SME data starts from just ₦25, making it the cheapest MTN data option in Nigeria. MTN Corporate Gifting (CG) data and Direct data are also available at competitive rates. SME data is the most popular choice for resellers because of its low cost and instant delivery.

Glo Data Prices: Glo CG data is our most popular Glo offering, starting from ₦25. Glo Direct data is also available for users who prefer data that shows directly in their Glo balance.

Airtel Data Prices: Airtel SME and CG data bundles are available at the lowest rates in Nigeria. All Airtel data plans - daily, weekly, and monthly - are delivered within 8 seconds.

9mobile Data Prices: 9mobile data bundles are available at affordable rates. All 9mobile plans come with instant delivery to any 9mobile number.

Cable TV Subscription Prices: Pay for DSTV, GOTV, and Startimes subscriptions at face value with instant activation. All packages are available - from GOTV Smallie to DSTV Premium.

Electricity Token Prices: Buy electricity tokens for all 11 DISCOs in Nigeria (IKEDC, EKEDC, AEDC, IBEDC, JED, KAEDCO, KEDCO, PHED, BEDC, EEDC) at face value with instant delivery to your email and SMS.

Result Checker Prices: NECO result checker PIN at ₦650, WAEC scratch card at ₦700, JAMB e-PIN at ₦500. All PINs are delivered instantly to your email and SMS after payment. Prices are subject to change based on examination body pricing.

Recharge Card Printing (Airtime ePIN): Print recharge cards for MTN, Glo, Airtel, and 9Mobile directly from Bigisub. Available denominations: ₦100, ₦200, ₦500, and ₦1000. Each PIN comes with a ready-to-print card layout including your business name, serial number, load code (USSD), and network logo. No printing machine required — print on any A4 printer. Perfect for POS agents, phone shops, and airtime resellers. Prices are lower than physical scratch card wholesale rates.

Social Media Growth Packages: Grow your social media presence with affordable packages. Buy Instagram followers, TikTok followers, YouTube subscribers, and Facebook page likes. All orders are processed automatically with real engagement. Packages start from as low as ₦50. Track delivery progress in real-time from your dashboard.

DStv logo
41 Plans Available

Price (per month)

Live Data
DStv Movie Bundle Add-on N3500

NGN 3,500

DStv Compact Plus Movie Bundle Add-on E36 - N3,500

NGN 3,500

DStv Showmax Premier League Add-on N3,600

NGN 3,600

DStv Great Wall Standalone Bouquet N3,800

NGN 3,800

DStv Padi N4,400

NGN 4,400

+36 more plans
StarTimes logo
28 Plans Available

Price (per month)

Live Data
Nova (Antenna) - 700 Naira - 1 Week

NGN 700

Nova (Dish) - 700 Naira - 1 Week

NGN 700

Basic (Antenna) - 1400 Naira - 1 Week

NGN 1,400

Basic (Dish) - 1,700 Naira - 1 Week

NGN 1,700

Classic (Antenna) - 2000 Naira - 1 Week

NGN 2,000

+23 more plans
GOtv logo
8 Plans Available

Price (per month)

Live Data
GOtv Smallie - monthly N1900

NGN 1,900

GOtv Jinja N3,900

NGN 3,900

GOtv Smallie - quarterly N5,100

NGN 5,100

GOtv Jolli N5,800

NGN 5,800

GOtv Max N8,500

NGN 8,500

+3 more plans
Showmax logo
16 Plans Available

Price (per month)

Live Data
Mobile Only - N2,000

NGN 2,000

Sports Only - N3,600

NGN 3,600

Mobile Only - N4,000 - 3 Months

NGN 4,000

Full - N4,500

NGN 4,500

Sports Mobile Only - N4,500

NGN 4,500

+11 more plans
Data Prices and Service Rates - All Networks Nigeria

Electricity Bill Payment
Pay your electricity bills instantly with any of our supported providers

Minimum Amount:
₦1,000
Service Charge:
Free
Payment Type:
Prepaid & Postpaid
Supported Providers
Ikeja Electric (IKEDC)
Eko Electric (EKEDC)
Kano Electric (KEDCO)
Port Harcourt Electric (PHED)
Jos Electric (JED)
Ibadan Electric (IBEDC)
Kaduna Electric (KAEDCO)
Abuja Electric (AEDC)
Enugu Electric (EEDC)
Note: Payments are processed instantly. Ensure you have the correct meter number before proceeding.

Bulk SMS Service
Powered by Hollatags

Cost Per Page
₦5.00
Normal Text (SMS):
160 characters/page
Unicode (Emoji, Arabic):
70 characters/page
Delivery Rate:
98%+ Success Rate
Volume Discounts:
Available for 10,000+ SMS
Example Pricing
1,000 SMS
₦5,000
10,000 SMS
₦50,000
100,000 SMS
₦500,000

Exam Result Checker
Check your exam results instantly with our automated system

Available Exams
NABTEB
NABTEB Result Checker
₦1,000
NECO
NECO Result Checker
₦2,500
WAEC
WAEC Result Checker
₦5,250
Features
Instant result delivery
Multiple result checks per purchase
Secure and reliable
24/7 availability
Note: Ensure you have your examination number and year ready before checking your results.

nternet Data Plans
High-speed internet from leading ISP providers

Smile
Smile
Affordable 4G LTE internet plans

Price Range:
₦1,000 - ₦20,000
Data Range:
1GB - 100GB
Validity:
7 - 90 days
Unlimited Night Plans
FlexiDaily Plans
MidNite Plans
BigGa Plans
Spectranet
Spectranet
Premium unlimited internet

Price Range:
₦2,500 - ₦50,000
Data Range:
10GB - Unlimited
Validity:
30 - 365 days
Unlimited Plans
Fixed Data Plans
Home & Business Plans
4G LTE Coverage
Note: Prices may vary based on plan type and location. Contact support for specific plan details.

Sports Betting & Games
Instant Wallet Funding • No Extra Charges

₦0
Service Charge

Supported Platforms (35)
Bet9ja
Bet9ja
SportyBet
SportyBet
1xBet
1xBet
BetKing
BetKing
Nairabet
Nairabet
MerryBet
MerryBet
MSport
MSport
BetWay
BetWay
NaijaBet
NaijaBet
BetLand
BetLand
BetLion
BetLion
SupaBet
SupaBet

- 23 more platforms

✓ Instant Delivery
✓ 24/7 Availability
✓ Min Amount: ₦100
✓ Max Amount: ₦1,000,000
