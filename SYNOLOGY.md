# nodejs4synologynas

### Running a REST server on Synology NAS using Node.js 

1. Start by logging into DSM and going to Package Manager  
    1. Install the "Node.js" package. Pick the latest version - or a specific version if you're installing an legacy application. (On older version of DSM it might be located under "Developer Tools", the latest version just has an "All packages" tab.)
2. Still in DSM. Goto Control Panel, and in the File Sharing section select "Shared Folder".   
3. Create a new folder named "server". You can call it anything you'd like (or use an existing folder) but for the sake of this project I'll assume you are using the "server" folder.
4. In Control Panel, Goto "Terminal & SNMP". Make sure "Enable SSH service" is checked. We need SSH access later in this guide, but you can turn it off after everything is done. This will allow you to start a Secure SHell (command prompt) on the server.  
5. Using your PC or Mac open the "server" folder and make a folder called "local_opds_js"
6. Install [Putty](http://www.chiark.greenend.org.uk/~sgtatham/putty/latest.html) or similar SSH client to get console access to your NAS
7. Copy content of `dist` folder to `/volume1/server/local_opds_js`
8. Copy file `package.json` to `/volume1/server/local_opds_js`
9. Login to a command-shell on your Synology using Putty (or another SSH client - if you are on a Mac there is one built into the Terminal app) using your admin account
10. Change to the folder, so the command would be: ```cd /volume1/server/local_opds_js```
11. If your Node installation is complete - you should be able to use npm to install the dependiencies.
12. Type the commands: `npm init --yes` - to init the project with all default values. `npm install` to install and save the dependency
13. To keep the process runnning we use a Node package called "forever". To install it type `sudo npm install forever -g` The -g option installs the package globally - since it's not a dependency of the specific project, but rather a general utility we need on the server.
14. Create start script in server folder with name `start.sh`

```bash start.sh

export PORT=9000 
export EBOOK_DIR=/volume1/PATH/TO/YOURS/EPUB/Library 

cd /volume1/server/local_opds_js
forever start -o out.log -e err.log index.js

```
15. Make script runable `sudo chmod +x start.sh`
16. Start the script as superuser with `sudo ./start.sh`
17. On cosole you should see something like this:

```text
arn:    --minUptime not set. Defaulting to: 1000ms
warn:    --spinSleepTime not set. Your script will exit if it does not stay up for at least 1000ms
info:    Forever processing file: index.js
(node:24635) Warning: Accessing non-existent property 'padLevels' of module exports inside circular dependency
(Use `node --trace-warnings ...` to show where the warning was created)
(node:24635) Warning: Accessing non-existent property 'padLevels' of module exports inside circular dependency
```

and in you find in server folder a file `out.log` with content like this:

```text
Base directory: /volume1/PATH/TO/YOURS/EPUB/Library/
Local OPDS server listening on http://localhost:9000/opds
Serving files from /volume1/PATH/TO/YOURS/EPUB/Library/ at /files/
```
and file `err.log` should be empty.

18. In your browser you should now be able to access the app using the URL: ```http://[ip-of-your-NAS]:9000``` (9000 being the Port your App is listening to) 

### Stop server

to stop the app you should know PID from server-app and forever service.

1. list all running forever processes

```bash 
sudo forever list
```

```text
info:    Forever processes running
data:    uid  command                                               script   forever pid   
data:    [0] _lTw /volume1/@appstore/Node.js_v20/usr/local/bin/node index.js 18305   18312  
```

2. stop server

```bash
sudo forever stop 0
```

where "0" is a uid from the list.

### Restart the Node.js server after each NAS restart (recommended)

logging into DSM and going to Control Panel - Task Sheduler -> Menu "Create" -> "Triggered Task" -> "User-defined script"

Taskname: "Start local opds server"
User: root
Event: boot-up
Enabled: yes

Task-Settings:

Run command:  `bash /volume1/server/local_opds_js/start.sh`

Now you can reboot DSN and check of automatic start the task.
