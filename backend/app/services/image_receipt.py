"""Image receipt generation for transactions.

Generates shareable PNG receipts with transaction details, QR code,
and PagePay branding - optimized for social media sharing.
"""

import io
import qrcode
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont

from app.models import BillTransaction


def generate_receipt_image(transaction: BillTransaction) -> bytes:
    """Generate PNG image receipt for a bill transaction.
    
    Args:
        transaction: BillTransaction model instance
        
    Returns:
        bytes: PNG image file content
    """
    # Canvas size optimized for mobile sharing (9:16 aspect ratio)
    width, height = 1080, 1920
    
    # Colors matching PagePay brand
    MINT = "#0E7C66"
    MINT_SOFT = "#D1FAE5"
    INK = "#1A1A1A"
    INK_MUTED = "#6B7280"
    WHITE = "#FFFFFF"
    SUCCESS_GREEN = "#10B981"
    ERROR_RED = "#DC2626"
    PENDING_GRAY = "#9CA3AF"
    
    # Create image with white background
    img = Image.new("RGB", (width, height), color=WHITE)
    draw = ImageDraw.Draw(img)
    
    # Try to load fonts, fallback to defaults
    try:
        font_logo = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 64)
        font_title = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 48)
        font_heading = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 36)
        font_body = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 32)
        font_label = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 28)
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 24)
    except Exception:
        font_logo = ImageFont.load_default()
        font_title = ImageFont.load_default()
        font_heading = ImageFont.load_default()
        font_body = ImageFont.load_default()
        font_label = ImageFont.load_default()
        font_small = ImageFont.load_default()
    
    y = 80
    
    # Header - PagePay Logo
    draw.text((540, y), "PagePay", fill=MINT, font=font_logo, anchor="mt")
    y += 90
    
    # Receipt Title
    draw.text((540, y), "Payment Receipt", fill=INK, font=font_title, anchor="mt")
    y += 80
    
    # Status Badge with background
    status_text = transaction.status.upper()
    if transaction.status == "success":
        status_color = SUCCESS_GREEN
        badge_bg = "#D1FAE5"
    elif transaction.status == "failed":
        status_color = ERROR_RED
        badge_bg = "#FEE2E2"
    else:
        status_color = PENDING_GRAY
        badge_bg = "#F3F4F6"
    
    # Draw status badge
    badge_width = 200
    badge_height = 60
    badge_x = (width - badge_width) // 2
    draw.rounded_rectangle(
        [(badge_x, y), (badge_x + badge_width, y + badge_height)],
        radius=15,
        fill=badge_bg
    )
    draw.text((540, y + 30), status_text, fill=status_color, font=font_body, anchor="mm")
    y += 100
    
    # Separator line
    draw.line([(100, y), (width - 100, y)], fill=MINT_SOFT, width=4)
    y += 60
    
    # Service name
    service_names = {
        'airtime': 'Airtime Recharge',
        'data': 'Data Bundle',
        'electricity': 'Electricity Token',
        'tv': 'Cable TV Subscription',
        'recharge_pin': 'Recharge PIN',
        'betting': 'Betting Wallet Funding',
        'isp': 'ISP Top-up',
        'education': 'Education PIN',
        'sms': 'Bulk SMS',
    }
    service_name = service_names.get(transaction.service, transaction.service.title())
    draw.text((540, y), service_name, fill=INK, font=font_heading, anchor="mt")
    y += 80
    
    # Transaction Details
    details = [
        ("Amount", f"₦{transaction.amount_naira:,.2f}"),
        ("Points Earned", f"{transaction.points_earned:,} SP"),
    ]
    
    # Add service-specific fields
    if transaction.phone:
        details.insert(0, ("Phone Number", transaction.phone))
    elif transaction.meter_number:
        details.insert(0, ("Meter Number", transaction.meter_number))
    elif transaction.smartcard_number:
        details.insert(0, ("Smartcard Number", transaction.smartcard_number))
    
    details.extend([
        ("Reference", transaction.reference),
        ("Date", transaction.created_at.strftime('%b %d, %Y at %I:%M %p')),
    ])
    
    if transaction.external_ref:
        details.append(("Provider Ref", transaction.external_ref))
    
    # Draw details in card
    card_padding = 60
    card_x = 100
    card_width = width - 200
    row_height = 80
    
    for label, value in details:
        # Label (left aligned)
        draw.text((card_x + card_padding, y), label, fill=INK_MUTED, font=font_label, anchor="lm")
        # Value (right aligned)
        draw.text((card_x + card_width - card_padding, y), value, fill=INK, font=font_body, anchor="rm")
        y += row_height
        
        # Separator line between rows
        if label != details[-1][0]:
            draw.line(
                [(card_x + card_padding, y - 20), (card_x + card_width - card_padding, y - 20)],
                fill="#E5E7EB",
                width=2
            )
    
    y += 40
    
    # Generate QR code
    qr = qrcode.QRCode(version=1, box_size=10, border=2)
    qr.add_data(f"PAGEPAY:{transaction.reference}")
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white")
    
    # Resize QR code
    qr_size = 300
    qr_img = qr_img.resize((qr_size, qr_size))
    
    # Center QR code
    qr_x = (width - qr_size) // 2
    img.paste(qr_img, (qr_x, y))
    y += qr_size + 40
    
    # QR instruction
    draw.text((540, y), "Scan to verify transaction", fill=INK_MUTED, font=font_label, anchor="mt")
    y += 80
    
    # Footer
    draw.line([(100, y), (width - 100, y)], fill=MINT_SOFT, width=4)
    y += 50
    
    # Generated timestamp
    generated_at = datetime.utcnow().strftime('%b %d, %Y at %I:%M %p UTC')
    draw.text((540, y), f"Generated on {generated_at}", fill=INK_MUTED, font=font_small, anchor="mt")
    y += 50
    
    # Contact info
    draw.text((540, y), "PagePay - Earn While You Pay", fill=MINT, font=font_label, anchor="mt")
    y += 40
    draw.text((540, y), "support@pagepay.ng | www.pagepay.ng", fill=INK_MUTED, font=font_small, anchor="mt")
    
    # Convert to bytes
    buffer = io.BytesIO()
    img.save(buffer, format="PNG", optimize=True)
    buffer.seek(0)
    return buffer.getvalue()
