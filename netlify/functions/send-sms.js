// netlify/functions/send-sms.js
exports.handler = async (event) => {
    try {
        const { phoneNumber, message, subject, deviceId, sender } = JSON.parse(event.body);
        
        // Forward to your SMS gateway APK
        const response = await fetch('http://your-gateway-ip:8080/api/sms', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                phone: phoneNumber,
                message: message,
                deviceId: deviceId,
                sender: sender
            })
        });
        
        const result = await response.json();
        return {
            statusCode: 200,
            body: JSON.stringify(result)
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
};
