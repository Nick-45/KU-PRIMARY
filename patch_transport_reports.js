const fs = require('fs');
let code = fs.readFileSync('src/pages/Transportation.jsx', 'utf8');

// 1. Add Reports tab
if (!code.includes("id: 'reports'")) {
    code = code.replace(/if \(isAdmin \|\| isAccountant\) {/, 
    `if (isAdmin || isAccountant) {
      tabs.push({ id: 'reports', label: 'Reports', icon: 'fa-file-alt' });`);
}

// 2. Add renderReports UI
if (!code.includes('const renderReports = () =>')) {
    const reportsUI = `
  const renderReports = () => {
    // Filter stats
    const totalCollected = transportPayments.reduce((sum, p) => p.status === 'completed' || p.status === 'success' ? sum + Number(p.amount || 0) : sum, 0);
    const activeAssignments = assignments.filter(a => a.status === 'active');
    
    return (
    <div className="reports-section">
      <div className="section-header">
        <h2>Transport Reports & Analytics</h2>
        <button className="btn btn-outline" onClick={() => window.print()}>
          <i className="fas fa-print"></i> Print Report
        </button>
      </div>

      <div className="stats-grid" style={{ marginBottom: '20px' }}>
        <div className="stat-card">
          <div className="stat-icon"><i className="fas fa-coins"></i></div>
          <div className="stat-info">
            <h3>Total Revenue</h3>
            <p>KES {totalCollected.toLocaleString()}</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><i className="fas fa-users"></i></div>
          <div className="stat-info">
            <h3>Active Assignments</h3>
            <p>{activeAssignments.length}</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><i className="fas fa-bus"></i></div>
          <div className="stat-info">
            <h3>Active Routes</h3>
            <p>{routes.length}</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><i className="fas fa-gas-pump"></i></div>
          <div className="stat-info">
            <h3>Fuel Records</h3>
            <p>{fuelRecords.length}</p>
          </div>
        </div>
      </div>

      <div className="reports-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
        <div className="report-card" style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: 'var(--shadow)' }}>
          <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '10px', marginBottom: '15px' }}>Route Popularity</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {routes.map(r => {
              const count = assignments.filter(a => a.routeId === r.id && a.status === 'active').length;
              return (
                <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed var(--border)' }}>
                  <span>{r.name}</span>
                  <strong>{count} students</strong>
                </li>
              );
            })}
          </ul>
        </div>
        
        <div className="report-card" style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: 'var(--shadow)' }}>
          <h3 style={{ borderBottom: '1px solid var(--border)', paddingBottom: '10px', marginBottom: '15px' }}>Recent Payments</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {transportPayments.slice(0, 5).map(p => {
              const student = students.find(s => s.id === p.studentId);
              return (
                <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed var(--border)' }}>
                  <span>{student?.firstName} {student?.lastName}</span>
                  <span style={{ color: p.status === 'completed' || p.status === 'success' ? 'var(--success)' : 'var(--warning)' }}>
                    KES {p.amount}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
};
`;
    code = code.replace(/const renderStudentRides = \(\) => {/, reportsUI + '\n  const renderStudentRides = () => {');
}

// 3. Register renderReports in activeTab switch
if (!code.includes("activeTab === 'reports' && renderReports()")) {
    code = code.replace(/{activeTab === 'student-rides' && isTeacher && renderStudentRides\(\)}/, 
    `{activeTab === 'student-rides' && isTeacher && renderStudentRides()}\n        {activeTab === 'reports' && (isAdmin || isAccountant) && renderReports()}`);
}

fs.writeFileSync('src/pages/Transportation.jsx', code);
console.log("Patched Transport Reports");
