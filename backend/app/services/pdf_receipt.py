"""PDF receipt generation for bill transactions.

Generates downloadable PDF receipts with QR code, transaction details,
and PagePay branding.
"""

import io
import qrcode
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT, TA_LEFT

from app.models import BillTransaction


def generate_receipt_pdf(transaction: BillTransaction) -> bytes:
    """Generate PDF receipt for a bill transaction.
    
    Args:
        transaction: BillTransaction model instance
        
    Returns:
        bytes: PDF file content
    """
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, topMargin=0.5*inch, bottomMargin=0.5*inch)
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#0E7C66'),
        alignment=TA_CENTER,
        spaceAfter=12,
    )
    
    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=16,
        textColor=colors.HexColor('#0E7C66'),
        spaceAfter=10,
    )
    
    normal_style = ParagraphStyle(
        'CustomNormal',
        parent=styles['Normal'],
        fontSize=11,
        spaceAfter=6,
    )
    
    right_align_style = ParagraphStyle(
        'RightAlign',
        parent=styles['Normal'],
        fontSize=11,
        alignment=TA_RIGHT,
    )
    
    story = []
    
    # Header
    story.append(Paragraph("<b>PagePay</b>", title_style))
    story.append(Paragraph("Bill Payment Receipt", heading_style))
    story.append(Spacer(1, 0.2*inch))
    
    # Transaction Details
    service_names = {
        'airtime': 'Airtime Recharge',
        'data': 'Data Bundle',
        'electricity': 'Electricity Token',
        'tv': 'Cable TV Subscription',
        'recharge_pin': 'Recharge PIN',
        'betting': 'Betting Wallet Funding',
        'isp_smile': 'Smile ISP Top-up',
        'isp_spectranet': 'Spectranet ISP Top-up',
        'education': 'Result Checker PIN',
        'sms': 'Bulk SMS',
    }
    
    service_name = service_names.get(transaction.service, transaction.service.title())
    
    details_data = [
        ['Transaction Reference', transaction.reference],
        ['Service', service_name],
        ['Status', transaction.status.upper()],
        ['Amount', f'₦{transaction.amount_naira:,.2f}'],
        ['Points Earned', f'{transaction.points_earned:,} points'],
        ['Date', transaction.created_at.strftime('%B %d, %Y at %I:%M %p')],
    ]
    
    # Add service-specific fields
    if transaction.phone:
        details_data.insert(3, ['Phone Number', transaction.phone])
    
    # For data transactions, show network and plan details
    if transaction.service == "data" and transaction.details:
        if transaction.details.get("network_name"):
            details_data.insert(3, ['Network', transaction.details["network_name"]])
        if transaction.details.get("plan_name"):
            details_data.insert(4, ['Plan', transaction.details["plan_name"]])
        if transaction.details.get("size"):
            details_data.insert(5, ['Data Size', transaction.details["size"]])
    
    # For airtime transactions, show network
    if transaction.service == "airtime" and transaction.details:
        if transaction.details.get("network_name"):
            details_data.insert(3, ['Network', transaction.details["network_name"]])
    
    # For electricity transactions, show disco and meter details
    if transaction.service == "electricity" and transaction.details:
        if transaction.details.get("disco_name"):
            details_data.insert(3, ['Disco', transaction.details["disco_name"]])
        if transaction.details.get("customer_name"):
            details_data.insert(4, ['Customer Name', transaction.details["customer_name"]])
        if transaction.details.get("meter_type"):
            details_data.insert(5, ['Meter Type', transaction.details["meter_type"].title()])
        if transaction.details.get("token"):
            details_data.append(['Token', transaction.details["token"]])
        if transaction.details.get("units"):
            details_data.append(['Units', transaction.details["units"]])
    
    if transaction.meter_number:
        details_data.insert(3, ['Meter Number', transaction.meter_number])
    if transaction.smartcard_number:
        details_data.insert(3, ['Smartcard Number', transaction.smartcard_number])
    
    if transaction.external_ref:
        details_data.append(['Provider Reference', transaction.external_ref])
    
    details_table = Table(details_data, colWidths=[2.5*inch, 4*inch])
    details_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, -1), colors.HexColor('#F0F0F0')),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
        ('ALIGN', (0, 0), (0, -1), 'LEFT'),
        ('ALIGN', (1, 0), (1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (0, -1), 'Helvetica-Bold'),
        ('FONTNAME', (1, 0), (1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 0), (-1, -1), 11),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
    ]))
    
    story.append(details_table)
    story.append(Spacer(1, 0.3*inch))
    
    # Generate QR code with reference
    qr = qrcode.QRCode(version=1, box_size=10, border=2)
    qr.add_data(f"PAGEPAY:{transaction.reference}")
    qr.make(fit=True)
    qr_img = qr.make_image(fill_color="black", back_color="white")
    
    qr_buffer = io.BytesIO()
    qr_img.save(qr_buffer, format='PNG')
    qr_buffer.seek(0)
    
    qr_image = Image(qr_buffer, width=1.5*inch, height=1.5*inch)
    qr_table = Table([[qr_image]], colWidths=[1.5*inch])
    qr_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
    ]))
    
    story.append(qr_table)
    story.append(Spacer(1, 0.2*inch))
    
    # Footer
    story.append(Paragraph(
        "<i>Scan QR code to verify transaction</i>",
        ParagraphStyle('Center', parent=styles['Normal'], alignment=TA_CENTER, fontSize=9, textColor=colors.grey)
    ))
    story.append(Spacer(1, 0.3*inch))
    
    story.append(Paragraph(
        f"<i>Generated on {datetime.utcnow().strftime('%B %d, %Y at %I:%M %p UTC')}</i>",
        ParagraphStyle('Center', parent=styles['Normal'], alignment=TA_CENTER, fontSize=8, textColor=colors.grey)
    ))
    
    story.append(Spacer(1, 0.2*inch))
    story.append(Paragraph(
        "PagePay - Earn While You Pay<br/>support@pagepay.ng | www.pagepay.ng",
        ParagraphStyle('Center', parent=styles['Normal'], alignment=TA_CENTER, fontSize=9, textColor=colors.grey)
    ))
    
    doc.build(story)
    buffer.seek(0)
    return buffer.getvalue()
