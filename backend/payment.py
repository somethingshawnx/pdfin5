RAZORPAY_KEY_ID = "dummy_key_id"

def create_order(amount_inr, receipt):
    return {
        "id": "dummy_order_id",
        "amount": amount_inr * 100,
        "currency": "INR"
    }

def verify_signature(order_id, payment_id, signature):
    return True
