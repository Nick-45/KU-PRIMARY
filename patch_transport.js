const fs = require('fs');
let code = fs.readFileSync('src/pages/Transportation.jsx', 'utf8');

// 1. Add handleAddAssignment if missing
if (!code.includes('handleAddAssignment')) {
    const handleAddAssignmentCode = `
  const handleAddAssignment = async () => {
    try {
      const data = {
        ...assignmentForm,
        schoolId: userData?.schoolId || 'default_school',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (isOnline) {
        if (selectedAssignment) {
          await updateDoc(doc(db, 'assignments', selectedAssignment.id), data);
        } else {
          await addDoc(collection(db, 'assignments'), data);
        }
      } else {
        if (selectedAssignment) {
           await addToSyncQueue('assignments', 'update', { id: selectedAssignment.id, ...data });
           setAssignments(assignments.map(a => a.id === selectedAssignment.id ? { ...a, ...data } : a));
        } else {
           await addToSyncQueue('assignments', 'add', data);
           setAssignments([data, ...assignments]);
        }
      }
      showNotification('Assignment saved successfully!', 'success');
      setShowModal(false);
    } catch (err) {
      console.error(err);
      showNotification('Error saving assignment', 'error');
    }
  };

  const handleDeleteAssignment = async () => {
    try {
      if (isOnline) {
        await deleteDoc(doc(db, 'assignments', deleteItem.id));
      } else {
        await addToSyncQueue('assignments', 'delete', { id: deleteItem.id });
        setAssignments(assignments.filter(a => a.id !== deleteItem.id));
      }
      showNotification('Assignment deleted', 'success');
      setShowDeleteModal(false);
    } catch (err) {
      console.error(err);
      showNotification('Error deleting assignment', 'error');
    }
  };
`;

    code = code.replace(/const handleAddPayment = async \(\) => {/, handleAddAssignmentCode + '\n  const handleAddPayment = async () => {');
}

// 2. Add assignments form to renderModal
if (!code.includes("case 'assignment':")) {
    const assignmentFormUI = `
      case 'assignment':
        return (
          <div className="modal">
            <div className="modal-header">
              <h2>{selectedAssignment ? 'Edit Assignment' : 'Assign Student to Route'}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}><i className="fas fa-times"></i></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleAddAssignment(); }}>
              <div className="form-row">
                <div className="form-group">
                  <label>Student <span className="required">*</span></label>
                  <select
                    value={assignmentForm.studentId}
                    onChange={(e) => setAssignmentForm({ ...assignmentForm, studentId: e.target.value })}
                    required
                  >
                    <option value="">Select Student</option>
                    {students.map(s => (
                      <option key={s.id} value={s.id}>{s.firstName} {s.lastName} ({s.class})</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Route <span className="required">*</span></label>
                  <select
                    value={assignmentForm.routeId}
                    onChange={(e) => setAssignmentForm({ ...assignmentForm, routeId: e.target.value })}
                    required
                  >
                    <option value="">Select Route</option>
                    {routes.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Bus <span className="required">*</span></label>
                  <select
                    value={assignmentForm.busId}
                    onChange={(e) => setAssignmentForm({ ...assignmentForm, busId: e.target.value })}
                    required
                  >
                    <option value="">Select Bus</option>
                    {buses.map(b => (
                      <option key={b.id} value={b.id}>{b.registrationNumber}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Status <span className="required">*</span></label>
                  <select
                    value={assignmentForm.status}
                    onChange={(e) => setAssignmentForm({ ...assignmentForm, status: e.target.value })}
                    required
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Pickup Point</label>
                  <input
                    type="text"
                    value={assignmentForm.pickupPoint}
                    onChange={(e) => setAssignmentForm({ ...assignmentForm, pickupPoint: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Pickup Time</label>
                  <input
                    type="time"
                    value={assignmentForm.pickupTime}
                    onChange={(e) => setAssignmentForm({ ...assignmentForm, pickupTime: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Dropoff Point</label>
                  <input
                    type="text"
                    value={assignmentForm.dropoffPoint}
                    onChange={(e) => setAssignmentForm({ ...assignmentForm, dropoffPoint: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Dropoff Time</label>
                  <input
                    type="time"
                    value={assignmentForm.dropoffTime}
                    onChange={(e) => setAssignmentForm({ ...assignmentForm, dropoffTime: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary"><i className="fas fa-save"></i> Save</button>
              </div>
            </form>
          </div>
        );
`;
    code = code.replace(/case 'payment':/, assignmentFormUI + "\n      case 'payment':");
}

// 3. Add renderAssignments UI
if (!code.includes('const renderAssignments = () =>')) {
    const assignmentsUI = `
  const renderAssignments = () => (
    <div className="assignments-section">
      <div className="section-header">
        <h2>Student Route Assignments</h2>
        <button className="btn btn-primary" onClick={() => {
          setModalType('assignment');
          setSelectedAssignment(null);
          setAssignmentForm({
            studentId: '', routeId: '', busId: '', pickupPoint: '', pickupTime: '', dropoffPoint: '', dropoffTime: '', status: 'active'
          });
          setShowModal(true);
        }}>
          <i className="fas fa-plus"></i> New Assignment
        </button>
      </div>
      <div className="filters-section">
        <input type="text" className="search-input" placeholder="Search by student name..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
      </div>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Route</th>
              <th>Bus</th>
              <th>Pickup</th>
              <th>Dropoff</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {assignments
              .filter(a => {
                const s = students.find(s => s.id === a.studentId);
                if (!s) return false;
                const name = \`\${s.firstName} \${s.lastName}\`.toLowerCase();
                return name.includes(searchTerm.toLowerCase());
              })
              .map(assignment => {
              const student = students.find(s => s.id === assignment.studentId);
              const route = routes.find(r => r.id === assignment.routeId);
              const bus = buses.find(b => b.id === assignment.busId);
              return (
                <tr key={assignment.id}>
                  <td>{student?.firstName} {student?.lastName}</td>
                  <td>{route?.name || 'N/A'}</td>
                  <td>{bus?.registrationNumber || 'N/A'}</td>
                  <td>{assignment.pickupPoint} at {assignment.pickupTime}</td>
                  <td>{assignment.dropoffPoint} at {assignment.dropoffTime}</td>
                  <td>
                    <span className={\`status-badge \${assignment.status}\`}>
                      {assignment.status.charAt(0).toUpperCase() + assignment.status.slice(1)}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-primary btn-sm" onClick={() => {
                      setSelectedAssignment(assignment);
                      setModalType('assignment');
                      setAssignmentForm(assignment);
                      setShowModal(true);
                    }}>
                      <i className="fas fa-edit"></i>
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => {
                      setDeleteItem(assignment);
                      setDeleteType('assignment');
                      setShowDeleteModal(true);
                    }}>
                      <i className="fas fa-trash"></i>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
`;
    code = code.replace(/const renderStudentRides = \(\) => {/, assignmentsUI + '\n  const renderStudentRides = () => {');
}

// 4. Register renderAssignments in activeTab switch
if (!code.includes("activeTab === 'assignments' && renderAssignments()")) {
    code = code.replace(/{activeTab === 'student-rides' && isTeacher && renderStudentRides\(\)}/, 
    `{activeTab === 'student-rides' && isTeacher && renderStudentRides()}\n        {activeTab === 'assignments' && isAdmin && renderAssignments()}`);
}

// 5. Delete handler cases
code = code.replace(/case 'route':\s*\/\/ handleDeleteRoute\(\);\s*break;/, `case 'route':
                      // handleDeleteRoute();
                      break;
                    case 'assignment':
                      handleDeleteAssignment();
                      break;`);

fs.writeFileSync('src/pages/Transportation.jsx', code);
console.log("Patched Transport Assignments");
