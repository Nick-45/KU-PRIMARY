function numberToWords(num) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    function under1000(n) {
        if (n === 0) return '';
        if (n < 10) return ones[n];
        if (n < 20) return teens[n - 10];
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
        return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + under1000(n % 100) : '');
    }
    function convert(n) {
        if (n === 0) return 'Zero';
        if (n < 1000) return under1000(n);
        const scales = [{ v: 1e9, name: 'Billion' }, { v: 1e6, name: 'Million' }, { v: 1e3, name: 'Thousand' }];
        for (const { v, name } of scales) {
            if (n >= v) {
                const head = Math.floor(n / v);
                const tail = n % v;
                return convert(head) + ' ' + name + (tail ? ' ' + convert(tail) : '');
            }
        }
        return String(n);
    }
    if (!num || num === 0) return 'Zero Shillings Only';
    return convert(Math.round(num)) + ' Shillings Only';
}
function fmtKES(n) { return 'KES ' + Number(n || 0).toLocaleString('en-KE'); }
module.exports = { numberToWords, fmtKES };
