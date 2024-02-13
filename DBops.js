import pgpkg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const {Client} = pgpkg;
let sql;

sqlconn();

async function sqlconn(){ // IMPURE
    sql = new Client();
    await sql.connect();
    const res = await sql.query('SELECT $1::text as message', ['Hello world!']);
    if(res?.rows[0]?.message) console.log('db conn OK');
}

//////////////////////// ======= DB operations ======== \\\\\\\\\\\\\\\\\\\\\\\\
const db_ops = {
    db_getAllCompanies : {
        fn: async () => {
            const query = {
                text:`SELECT symbol, c.cik, country, mcap, f.chunks
                    from companies c
                    join filings f on c.cik=f.cik
                    order by case when chunks is null then 0 else chunks end desc`,
                values:[]
            }
            return await sql.query(query);
        },
        required_params: [],
    }, 
    db_insertConvo : {
        fn: async (oo) => {
            const {convoID, uid, ticker} = oo;
            let query = {
                text:`
                INSERT INTO conversations (convoID, uid, symbol)
                SELECT $1, $2, $3`,
                values: [convoID, uid, ticker]
            }
            return await sql.query(query);
        },
        required_params : ['convoID', 'uid', 'ticker']
    },
    db_getConvo : {
        fn: async (oo) => { //TODO: auth with uid too
            const {convoID} = oo;
            const msgs_query = {
                text: 'SELECT id, agent, convoid, msg, date from messages where convoid = $1',
                values: [convoID]
            }
            const convo_query = {
                text:`
                    SELECT convoid, uid, c.symbol, createddate, f.typ, f.repdate, f.cik, f.id as filingid
                    from conversations c
                    join companies co on c.symbol=co.symbol
                    left join filings f on f.cik=co.cik
                    where convoID = $1;
                    `,
                    values:[convoID]
            }    
            let res = [await sql.query(msgs_query), await sql.query(convo_query)];
            return res.map(set => set?.rows || []);
        }, 
        required_params : ['convoID']
    },
    db_getReport : {
        fn: async (oo) => {
            const {cik} = oo;
            const query = {
                text:'SELECT * from filings where cik = $1',
                values:[cik]
            }    
            return await sql.query(query);
        },
        required_params: ['cik'],
    },
    db_getUser: {
        fn: async (oo) => {
            const {uid} = oo;
            const query = {
                text:'SELECT fname, lname, email, uid from users where uid = $1',
                values:[uid]
            }
            return await sql.query(query);
        },
        required_params: ['uid']
    },
    db_sendMessage : {
        fn: async (oo) => {
            const {convoID, msg, agent} = oo;
            const query = {
                text: `
                    INSERT INTO messages (agent, convoID, msg)
                    SELECT $1, $2, $3
                `,
                values: [agent, convoID, msg]
            }
            return await sql.query(query);
        },
        required_params: ['agent', 'convoID', 'msg'],
    },
    db_insertFiling: {
        fn: async (oo) => {
            const {cik, reportURL, year, date, typ} = oo;
            const query = {
                text: `CALL insert_filing (
                    $1::character varying, 
                    $2::character varying, 
                    $3::smallint, 
                    $4::date, 
                    $5::character varying
                );`,
                values: [
                    cik,
                    reportURL.replace('https://www.sec.gov/Archives/edgar/data/',''),
                    year,
                    date,
                    typ
                ],
            }
            await sql.query(query).catch(err => console.log(err));
            },
        required_params: ['cik', 'reportURL', 'year', 'date', 'typ']
    },

    db_get_apitoken_by_uid : {
        fn: async (oo) => {
            const {uid} = oo;
            const query = {
                text:`SELECT a.apitoken, u.credits
                    from apitokens a
                    join users u on u.uid=a.uid
                    where a.uid = $1 and CURRENT_TIMESTAMP < a.exptime`,
                values:[uid]
            }    
            return await sql.query(query);
        },
        required_params: ['uid'],
    },

    db_verify_apitoken : {
        fn: async (oo) => {
            const {apitoken} = oo;
            const query = {
                text:`SELECT u.uid, u.credits
                    from apitokens a
                    join users u on u.uid=a.uid
                    where a.apitoken = $1 and CURRENT_TIMESTAMP < a.exptime`,
                values:[apitoken]
            }    
            return await sql.query(query);
        },
        required_params: ['apitoken'],
    },

    db_credit_account : {
        fn: async (oo) => {
            const {uid} = oo;
            const query = {
                text:`
                    UPDATE users
                    SET credits = credits - 1
                    WHERE uid = $1`,
                values:[uid]
            }    
            return await sql.query(query);
        },
        required_params: ['uid'],
    },

    db_write_apitoken : {
        fn: async (oo) => {
            const {uid, apitoken, exptime} = oo;
            const query = {
                text:`INSERT INTO apitokens (uid, apitoken, exptime)
                    VALUES ($1, $2, $3)`,
                values:[uid, apitoken, exptime]
            }    
            return await sql.query(query);
        },
        required_params: ['uid', 'apitoken', 'exptime'],
    },

    db_template : {
        fn: async (oo) => {
            const {cik} = oo;
            const query = {
                text:'SELECT * from filings where cik = $1',
                values:[cik]
            }    
            return await sql.query(query);
        },
        required_params: ['cik'],
    },
}

//////////////////////// ======= DB methods ======== \\\\\\\\\\\\\\\\\\\\\\\\

function check_required_params(fn_obj, args){
    const {required_params} = fn_obj;
    const fn_name = Object.keys(fn_obj)[0];
    const missing_req_params = required_params.filter(param => !Object.keys(args).includes(param));
    if(!missing_req_params.length) return;
    if(missing_req_params.length === 1) throw new Error(`${fn_name}: Missing parameter: ${missing_req_params[0]}`);
    if(missing_req_params.length > 1) throw new Error(`${fn_name}: Missing parameters: ${missing_req_params.join(', ')}`);
}

async function DBcall(fn_string, args=[]){
    let res;
    try{
        if (typeof db_ops[fn_string]?.fn != 'function') return console.error(`Function ${fn_string} does not exist in db_obs`);
        const fn = db_ops[fn_string].fn;
        check_required_params(db_ops[fn_string], args);
        res = await fn(args);
    } catch(err){
        console.log(fn_string && fn_string, err);
        res = {error:true};
    }
    return res;
}

export {DBcall, sql};