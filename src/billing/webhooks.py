# backend/src/billing/webhooks.py
import json
import stripe
from typing import Dict, Any
from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse

from core.config import settings
from .service import billing_service

router = APIRouter()


@router.post("/stripe/webhook")
async def stripe_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Handle Stripe webhook events
    """
    payload = await request.body()
    sig_header = request.headers.get('stripe-signature')
    
    if not settings.STRIPE_WEBHOOK_SECRET:
        return JSONResponse(
            content={"error": "Webhook secret not configured"},
            status_code=400
        )
    
    try:
        # Verify webhook signature
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )
    except ValueError as e:
        # Invalid payload
        return JSONResponse(
            content={"error": str(e)},
            status_code=400
        )
    except stripe.error.SignatureVerificationError as e:
        # Invalid signature
        return JSONResponse(
            content={"error": str(e)},
            status_code=400
        )
    
    # Handle the event
    event_type = event['type']
    event_data = event['data']['object']
    
    # Process in background
    background_tasks.add_task(
        process_stripe_event,
        event_type,
        event_data
    )
    
    return JSONResponse(
        content={"received": True},
        status_code=200
    )


async def process_stripe_event(event_type: str, event_data: Dict[str, Any]):
    """
    Process Stripe webhook event
    """
    try:
        print(f"Processing Stripe event: {event_type}")
        
        if event_type == 'customer.subscription.created':
            await handle_subscription_created(event_data)
        elif event_type == 'customer.subscription.updated':
            await handle_subscription_updated(event_data)
        elif event_type == 'customer.subscription.deleted':
            await handle_subscription_deleted(event_data)
        elif event_type == 'invoice.payment_succeeded':
            await handle_invoice_payment_succeeded(event_data)
        elif event_type == 'invoice.payment_failed':
            await handle_invoice_payment_failed(event_data)
        elif event_type == 'invoice.finalized':
            await handle_invoice_finalized(event_data)
        elif event_type == 'payment_intent.succeeded':
            await handle_payment_intent_succeeded(event_data)
        elif event_type == 'payment_intent.payment_failed':
            await handle_payment_intent_failed(event_data)
        else:
            print(f"Unhandled event type: {event_type}")
            
    except Exception as e:
        print(f"Error processing Stripe event: {e}")


async def handle_subscription_created(subscription_data: Dict[str, Any]):
    """Handle subscription created event"""
    try:
        # Extract metadata
        company_id = subscription_data.get('metadata', {}).get('company_id')
        plan_type = subscription_data.get('metadata', {}).get('plan_type')
        
        if not company_id or not plan_type:
            return
        
        # Update subscription in database
        # This would update stripe_subscription_id and other fields
        
        print(f"Subscription created for company {company_id}")
        
    except Exception as e:
        print(f"Error handling subscription created: {e}")


async def handle_subscription_updated(subscription_data: Dict[str, Any]):
    """Handle subscription updated event"""
    try:
        subscription_id = subscription_data.get('id')
        status = subscription_data.get('status')
        
        # Update subscription status in database
        
        print(f"Subscription {subscription_id} updated to {status}")
        
    except Exception as e:
        print(f"Error handling subscription updated: {e}")


async def handle_subscription_deleted(subscription_data: Dict[str, Any]):
    """Handle subscription deleted event"""
    try:
        subscription_id = subscription_data.get('id')
        
        # Mark subscription as canceled in database
        
        print(f"Subscription {subscription_id} deleted")
        
    except Exception as e:
        print(f"Error handling subscription deleted: {e}")


async def handle_invoice_payment_succeeded(invoice_data: Dict[str, Any]):
    """Handle invoice payment succeeded"""
    try:
        invoice_id = invoice_data.get('id')
        amount_paid = invoice_data.get('amount_paid', 0) / 100  # Convert from cents
        
        # Update invoice status in database
        # Create payment record
        
        print(f"Invoice {invoice_id} paid: €{amount_paid}")
        
    except Exception as e:
        print(f"Error handling invoice payment succeeded: {e}")


async def handle_invoice_payment_failed(invoice_data: Dict[str, Any]):
    """Handle invoice payment failed"""
    try:
        invoice_id = invoice_data.get('id')
        
        # Update invoice status to past_due
        
        print(f"Invoice {invoice_id} payment failed")
        
    except Exception as e:
        print(f"Error handling invoice payment failed: {e}")


async def handle_invoice_finalized(invoice_data: Dict[str, Any]):
    """Handle invoice finalized"""
    try:
        invoice_id = invoice_data.get('id')
        pdf_url = invoice_data.get('invoice_pdf')
        
        # Update invoice with PDF URL
        
        print(f"Invoice {invoice_id} finalized")
        
    except Exception as e:
        print(f"Error handling invoice finalized: {e}")


async def handle_payment_intent_succeeded(payment_data: Dict[str, Any]):
    """Handle payment intent succeeded"""
    try:
        payment_id = payment_data.get('id')
        amount = payment_data.get('amount', 0) / 100
        
        print(f"Payment {payment_id} succeeded: €{amount}")
        
    except Exception as e:
        print(f"Error handling payment intent succeeded: {e}")


async def handle_payment_intent_failed(payment_data: Dict[str, Any]):
    """Handle payment intent failed"""
    try:
        payment_id = payment_data.get('id')
        error_message = payment_data.get('last_payment_error', {}).get('message', 'Unknown error')
        
        print(f"Payment {payment_id} failed: {error_message}")
        
    except Exception as e:
        print(f"Error handling payment intent failed: {e}")
