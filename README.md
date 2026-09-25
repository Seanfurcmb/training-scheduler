# בונה לו"ז אימונים

אתר סטטי (HTML/JS בלי build) לבניית לו"ז אימונים בגרירה, סיכום ציוד וייצוא ליומן.

- **אימונים**: לוח לפי ימים, 06:00–00:00, קפיצות של 10 דקות. גוררים שיעורים מהמאגר, משנים אורך במשיכה בתוך טווח המינימום-מקסימום, ומוסיפים ארוחות, הפסקות וחלונות ללו"ז חיצוני.
- **מאגר שיעורים**: זמן אידיאלי, מינימום, מקסימום וציוד נדרש לכל שיעור.
- **ציוד**: פריט רב-פעמי נספר לפי הכמות הגדולה ביותר במשבצת אחת. פריט מתכלה מצטבר. כמות יכולה להיות קבועה או לפי מספר המתאמנים.
- **שליחה למתאמנים**: קישור לדף לו"ז (הנתונים נשמרים בתוך הקישור עצמו), קובץ `.ics`, וקישורי גוגל קלנדר לכל משבצת.

## הרצה מקומית

```bash
python -m http.server 8765
```
ואז לפתוח את http://localhost:8765.

כל עוד `js/firebase-config.js` מכיל `null`, הנתונים נשמרים רק בדפדפן הנוכחי.

## חיבור Firebase (שמירה משותפת לכל המדריכים)

1. נכנסים ל-https://console.firebase.google.com ← **Add project** (אפשר בלי Google Analytics).
2. **Build ← Authentication ← Get started ← Google ← Enable**.
3. **Build ← Firestore Database ← Create database**, בוחרים מיקום (למשל `europe-west`) ו-production mode.
4. בלשונית **Rules** מדביקים את התוכן של `firestore.rules` ← **Publish**.
5. בלשונית **Data**: **Start collection** בשם `staff`. ה-Document ID הוא כתובת ה-Gmail שלכם באותיות קטנות, עם שדה כלשהו (למשל `admin: true`). זה המדריך הראשון, ואת השאר מוסיפים מתוך האתר במסך "צוות".
6. **Project settings ← General ← Your apps ← Web (`</>`)**, רושמים אפליקציה ומעתיקים את אובייקט `firebaseConfig` לקובץ `js/firebase-config.js`:
   ```js
   export const firebaseConfig = { apiKey: '...', authDomain: '...', projectId: '...', appId: '...' };
   ```
7. **Authentication ← Settings ← Authorized domains**: מוסיפים את הדומיין של האתר (למשל `USERNAME.github.io`).


## פרסום ב-GitHub Pages

יוצרים ריפו, מעלים את הקבצים, ובהגדרות מפעילים **Settings ← Pages ← Deploy from branch ← main / root**.
