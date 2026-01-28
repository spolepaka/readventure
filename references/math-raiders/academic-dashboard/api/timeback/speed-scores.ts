import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * API route to fetch Speed Scores from TimeBack for a student.
 * GET /api/timeback/speed-scores?email=foo@bar.com
 * Returns: { speedScores: [{ date, grade, track, cqpm }] }
 */

const TIMEBACK_AUTH_URL = 'https://prod-beyond-timeback-api-2-idp.auth.us-east-1.amazoncognito.com/oauth2/token';
const TIMEBACK_API_BASE = 'https://api.alpha-1edtech.ai';

interface SpeedScore {
  date: string;
  grade: number;
  track: string;
  cqpm: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const email = req.query.email as string;
  
  if (!email) {
    return res.status(400).json({ error: 'email required' });
  }
  
  const clientId = process.env.TIMEBACK_CLIENT_ID;
  const clientSecret = process.env.TIMEBACK_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'TimeBack credentials not configured' });
  }
  
  try {
    // Get auth token
    const authRes = await fetch(TIMEBACK_AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`
    });
    
    if (!authRes.ok) {
      return res.status(500).json({ error: 'TimeBack auth failed' });
    }
    
    const { access_token } = await authRes.json();
    
    // Find user by email
    const userRes = await fetch(
      `${TIMEBACK_API_BASE}/ims/oneroster/rostering/v1p2/users?filter=email='${email}'`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    
    const userData = await userRes.json();
    const user = userData.users?.[0];
    
    if (!user) {
      return res.json({ error: 'User not found', speedScores: [] });
    }
    
    const timebackId = user.sourcedId;
    
    // Fetch all assessments (paginate if needed)
    let allResults: any[] = [];
    let offset = 0;
    const limit = 3000;
    
    while (true) {
      const fetchRes = await fetch(
        `${TIMEBACK_API_BASE}/ims/oneroster/gradebook/v1p2/assessmentResults?filter=student.sourcedId='${timebackId}'&limit=${limit}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      
      if (!fetchRes.ok) break;
      
      const data = await fetchRes.json();
      const results = data.assessmentResults || [];
      allResults.push(...results);
      
      if (results.length < limit) break;
      offset += limit;
    }
    
    // Filter to Speed Scores only (have cqpm + grade in metadata)
    const speedScores: SpeedScore[] = allResults
      .filter(r => r.metadata?.cqpm !== undefined && r.metadata?.grade !== undefined)
      .map(r => {
        // Check both title and sourcedId for track info
        const trackSource = r.assessmentLineItem?.title || r.assessmentLineItem?.sourcedId || '';
        const trackMatch = trackSource.match(/track(\d+)/i);
        return {
          date: r.scoreDate?.slice(0, 10) || '',
          grade: Number(r.metadata.grade),
          track: trackMatch ? `TRACK${trackMatch[1]}` : '',
          cqpm: Math.round(r.metadata.cqpm * 10) / 10,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    
    // Cache for 5 minutes to reduce API calls
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.json({ speedScores });
    
  } catch (err) {
    console.error('TimeBack API error:', err);
    return res.status(500).json({ error: 'TimeBack API error' });
  }
}
