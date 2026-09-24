// src/components/Results/RankingModal.jsx
import React, { useMemo } from 'react';
import { getCBCGrade } from '../../utils/constants';

export default function RankingModal({ students, studentScores, meta, onClose, onDownloadPDF }) {
    const subjects = meta.subjects || [];

    const ranking = useMemo(() => {
        const data = students.map(s => {
            const scores = studentScores[s.id] || [];
            const subjectScores = {};
            let total = 0, count = 0;
            subjects.forEach(sub => {
                const sc = scores.find(x => x.subject === sub);
                subjectScores[sub] = sc ? sc.score : null;
                if (sc) { total += sc.score; count++; }
            });
            const average = count ? Math.round(total / count) : 0;
            return {
                ...s,
                subjectScores,
                totalMarks: total,
                average,
                cbcGrade: getCBCGrade(average)
            };
        });
        return data.sort((a, b) => b.average - a.average);
    }, [students, studentScores, subjects]);

    const classMean = useMemo(() => {
        const scored = ranking.filter(s => s.average > 0);
        return scored.length
            ? Math.round(scored.reduce((a, s) => a + s.average, 0) / scored.length)
            : 0;
    }, [ranking]);

    return (
        <div style={overlay}>
            <div style={{ ...modal, maxWidth: 1200 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
                    <h2 style={{ fontSize: 22, color: 'var(--secondary)' }}>
                        <i className="fas fa-trophy"></i> Ranking — {meta.cls} / {meta.term}
                    </h2>
                    <div style={{ display: 'flex', gap: 10 }}>
                        <button onClick={onDownloadPDF} style={{ ...btn, background: '#e74c3c' }}>
                            <i className="fas fa-file-pdf"></i> Download PDF
                        </button>
                        <button onClick={onClose} style={btn}>
                            <i className="fas fa-times"></i> Close
                        </button>
                    </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                            <tr style={{ background: 'var(--primary)', color: 'white' }}>
                                <th style={th}>Rank</th>
                                <th style={th}>Name</th>
                                <th style={th}>Adm No</th>
                                {subjects.map(s => <th key={s} style={th}>{s}</th>)}
                                <th style={th}>Total</th>
                                <th style={th}>Avg</th>
                                <th style={th}>Grade</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ranking.map((s, i) => (
                                <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                    <td style={td}>#{i + 1}</td>
                                    <td style={td}>{s.firstName} {s.lastName}</td>
                                    <td style={td}>{s.admissionNumber || s.studentId || 'N/A'}</td>
                                    {subjects.map(sub => (
                                        <td key={sub} style={{ ...td, textAlign: 'center' }}>
                                            {s.subjectScores[sub] ?? '-'}
                                        </td>
                                    ))}
                                    <td style={{ ...td, textAlign: 'center', fontWeight: 700 }}>{s.totalMarks}</td>
                                    <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{s.average}%</td>
                                    <td style={{ ...td, textAlign: 'center' }}>{s.cbcGrade.code}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr style={{ background: 'var(--light)', fontWeight: 700 }}>
                                <td colSpan={2 + subjects.length} style={{ ...td, textAlign: 'right' }}>
                                    Class Mean:
                                </td>
                                <td colSpan={3} style={{ ...td, textAlign: 'center', color: 'var(--primary)', fontSize: 16 }}>
                                    {classMean}% ({getCBCGrade(classMean).code})
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
}

const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
    zIndex: 1000, display: 'flex', alignItems: 'center',
    justifyContent: 'center', padding: 20
};
const modal = {
    background: 'white', borderRadius: 16, maxWidth: 1200,
    width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 30
};
const btn = {
    padding: '10px 18px', background: 'var(--primary)', color: 'white',
    border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer'
};
const th = { padding: '10px 12px', textAlign: 'left' };
const td = { padding: '8px 12px' };
