// services/SchoolExitService.js
import { activeDb, archiveDb } from '../firebase/config';
import { 
  doc, setDoc, getDoc, updateDoc, deleteDoc, 
  collection, query, where, getDocs, writeBatch, 
  Timestamp, arrayUnion 
} from 'firebase/firestore';
import ExportService from './ExportService';

class SchoolExitService {
  async initiateExit(schoolId, initiatedBy) {
    const exitId = `exit_${schoolId}_${Date.now()}`;
    const exitData = {
      exitId,
      schoolId,
      initiatedBy,
      initiatedAt: new Date().toISOString(),
      exitDate: new Date().toISOString(),
      status: 'pending',
      retentionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      dataSummary: {},
      exportPackage: null,
      deletionSchedule: {
        scheduledFor: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        completed: false
      },
      history: [{
        action: 'initiated',
        timestamp: new Date().toISOString(),
        user: initiatedBy,
        note: 'School exit process initiated'
      }]
    };

    await setDoc(doc(activeDb, 'school_exits', exitId), exitData);
    return exitId;
  }

  async processExitPackage(exitId) {
    const exitRef = doc(activeDb, 'school_exits', exitId);
    const exitDoc = await getDoc(exitRef);
    
    if (!exitDoc.exists()) {
      throw new Error('Exit record not found');
    }
    
    const exitData = exitDoc.data();
    
    // 1. Collect all school data
    const schoolData = await this.collectSchoolData(exitData.schoolId);
    
    // 2. Generate PDF
    const pdfBlob = await ExportService.generateSchoolExitPackage(
      exitData.schoolId,
      schoolData,
      exitId
    );
    
    // 3. Upload PDF
    const { url, fileName } = await ExportService.uploadExportPDF(
      pdfBlob,
      exitData.schoolId,
      exitId
    );
    
    // 4. Archive data
    await this.archiveSchoolData(exitData.schoolId, exitId, schoolData);
    
    // 5. Update exit record
    await updateDoc(exitRef, {
      status: 'ready',
      exportPackage: {
        pdfUrl: url,
        fileName,
        generatedAt: new Date().toISOString(),
        downloadCount: 0
      },
      dataSummary: {
        totalStudents: schoolData.students?.length || 0,
        totalTeachers: schoolData.teachers?.length || 0,
        totalExams: schoolData.exams?.length || 0,
        totalScores: schoolData.scores?.length || 0,
        totalSubmissions: schoolData.submissions?.length || 0
      },
      history: arrayUnion({
        action: 'package_ready',
        timestamp: new Date().toISOString(),
        note: 'Export package generated and ready for download'
      })
    });
    
    return { url, fileName };
  }

  async collectSchoolData(schoolId) {
    // Collect all data from active database
    const collections = [
      'students',
      'teachers', 
      'exams',
      'student_scores',
      'exam_submissions',
      'fee_invoices',
      'fee_payments'
    ];
    
    const data = {};
    
    for (const collectionName of collections) {
      const q = query(
        collection(activeDb, collectionName),
        where('schoolId', '==', schoolId)
      );
      const snapshot = await getDocs(q);
      data[collectionName] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    }
    
    // Get school profile
    const schoolRef = doc(activeDb, 'schools', schoolId);
    const schoolDoc = await getDoc(schoolRef);
    data.schoolProfile = schoolDoc.exists() ? schoolDoc.data() : {};
    
    return data;
  }

  async archiveSchoolData(schoolId, exitId, data) {
    // Save to archive database
    const archiveRef = doc(archiveDb, 'school_archives', `${schoolId}_${exitId}`);
    await setDoc(archiveRef, {
      schoolId,
      exitId,
      exitDate: new Date().toISOString(),
      retentionEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      data: data,
      metadata: {
        totalStudents: data.students?.length || 0,
        totalTeachers: data.teachers?.length || 0,
        totalExams: data.exams?.length || 0,
        totalScores: data.scores?.length || 0
      }
    });
  }

  async downloadExportPackage(exitId) {
    const exitRef = doc(activeDb, 'school_exits', exitId);
    const exitDoc = await getDoc(exitRef);
    
    if (!exitDoc.exists()) {
      throw new Error('Exit record not found');
    }
    
    const exitData = exitDoc.data();
    
    // Increment download count
    await updateDoc(exitRef, {
      'exportPackage.downloadCount': (exitData.exportPackage?.downloadCount || 0) + 1,
      history: arrayUnion({
        action: 'downloaded',
        timestamp: new Date().toISOString(),
        note: 'Export package downloaded'
      })
    });
    
    return exitData.exportPackage.pdfUrl;
  }

  async scheduleDeletion(exitId) {
    const exitRef = doc(activeDb, 'school_exits', exitId);
    const exitDoc = await getDoc(exitRef);
    
    if (!exitDoc.exists()) {
      throw new Error('Exit record not found');
    }
    
    const exitData = exitDoc.data();
    const retentionEndDate = new Date(exitData.retentionEndDate);
    
    // Schedule Cloud Function to delete data after retention period
    // This would be handled by a Cloud Function with Cloud Scheduler
    
    await updateDoc(exitRef, {
      status: 'scheduled_deletion',
      'deletionSchedule.scheduledFor': retentionEndDate.toISOString(),
      history: arrayUnion({
        action: 'scheduled_deletion',
        timestamp: new Date().toISOString(),
        note: `Data scheduled for deletion on ${retentionEndDate.toLocaleDateString()}`
      })
    });
    
    return retentionEndDate;
  }

  async deleteSchoolData(schoolId, exitId) {
    // This will be called by a Cloud Function after 30 days
    const collections = [
      'students',
      'teachers',
      'exams',
      'student_scores',
      'exam_submissions',
      'fee_invoices',
      'fee_payments'
    ];
    
    const batch = writeBatch(activeDb);
    
    for (const collectionName of collections) {
      const q = query(
        collection(activeDb, collectionName),
        where('schoolId', '==', schoolId)
      );
      const snapshot = await getDocs(q);
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
    }
    
    await batch.commit();
    
    // Update exit record
    const exitRef = doc(activeDb, 'school_exits', exitId);
    await updateDoc(exitRef, {
      status: 'deleted',
      'deletionSchedule.completed': true,
      'deletionSchedule.deletedAt': new Date().toISOString(),
      history: arrayUnion({
        action: 'data_deleted',
        timestamp: new Date().toISOString(),
        note: 'School data permanently deleted after 30-day retention period'
      })
    });
  }
}

export default new SchoolExitService();
