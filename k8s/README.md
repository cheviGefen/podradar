# k8s

Kubernetes manifests for PodRadar, added step by step while learning Kubernetes.

## Local cluster

Docker Desktop's built-in Kubernetes (kubeadm, single node, v1.36). With kubeadm the node runs inside Docker Desktop's Linux VM and shares Docker's image store, so the images built with `docker compose build` are available to the cluster as they are.

Use Docker Desktop 4.83 or newer: in older versions `kubectl exec`, `attach` and `run -it` fail with "http: server gave HTTP response to HTTPS client" on Kubernetes 1.36, a cri-dockerd bug ([Mirantis/cri-dockerd#569](https://github.com/Mirantis/cri-dockerd/issues/569)). Updating Docker Desktop may recreate the cluster empty; everything here can be applied again from the steps below.

Check that kubectl talks to the right cluster before anything else:

```bash
kubectl config current-context   # docker-desktop
kubectl get nodes
```

## Apply

Run from the repository root.

1. The namespace that holds everything PodRadar runs:

   ```bash
   kubectl apply -f k8s/namespace.yaml
   ```

2. The MongoDB passwords, as a Secret (see below):

   ```bash
   kubectl create secret generic mongo-credentials --from-env-file=.env -n podradar
   ```

3. MongoDB's init script, as a ConfigMap that will be mounted into the MongoDB pod:

   ```bash
   kubectl apply -f k8s/mongo-init-configmap.yaml
   ```

   The manifest is generated from `database/init/`, so the script has a single source. After changing the script, regenerate it (in cmd or Git Bash; Windows PowerShell's `>` writes UTF-16, which kubectl cannot read):

   ```bash
   kubectl create configmap mongo-init --from-file=database/init -n podradar --dry-run=client -o yaml > k8s/mongo-init-configmap.yaml
   ```

4. MongoDB itself, as a StatefulSet: one pod with a stable name (`mongo-0`) and its own 1Gi disk (PersistentVolumeClaim `data-mongo-0`), which survives when the pod or the StatefulSet is deleted. The Secret and the ConfigMap above must exist first.

   ```bash
   kubectl apply -f k8s/mongo-statefulset.yaml
   kubectl get pods -n podradar -w
   ```

   To start MongoDB from scratch (this deletes its data), delete the StatefulSet first and then its disk; a PVC is not deleted while a pod still uses it:

   ```bash
   kubectl delete statefulset mongo -n podradar
   kubectl delete pvc data-mongo-0 -n podradar
   ```

5. A stable name for MongoDB, as a headless Service (`clusterIP: None`): the server connects to `mongo:27017`, whatever IP the pod gets after a restart.

   ```bash
   kubectl apply -f k8s/mongo-service.yaml
   kubectl get endpointslices -n podradar
   ```

6. A version tag for the app images. With `:latest`, Kubernetes defaults to `imagePullPolicy: Always`, tries to pull the image from Docker Hub, where it does not exist, and the pod gets stuck in `ImagePullBackOff`. With a fixed tag the default is `IfNotPresent`, so the local image is used.

   ```bash
   docker tag podradar-server:latest podradar-server:v1
   docker tag podradar-client:latest podradar-client:v1
   ```

7. The server's settings, as a ConfigMap read as environment variables:

   ```bash
   kubectl apply -f k8s/server-configmap.yaml
   ```

8. The server itself, as a Deployment. It builds `MONGO_URI` from the Secret with `$(NAME)` references, checks `/api/healthz` as its liveness probe and `/api/readyz` (which needs MongoDB) as its readiness probe, and runs as a non-root user. One replica, because in mock mode the simulated cluster lives in the pod's memory.

   ```bash
   kubectl apply -f k8s/server-deployment.yaml
   kubectl get pods -n podradar -w
   ```

   `1/1` means `/api/readyz` answered, so the server reached MongoDB with the password from the Secret.

9. A stable address for the server, as a regular ClusterIP Service: the client reaches it as `server:8000`.

   ```bash
   kubectl apply -f k8s/server-service.yaml
   ```

   To try the server from your computer, open a tunnel and keep it running, then call it from a second terminal:

   ```bash
   kubectl port-forward service/server 8000:8000 -n podradar
   curl.exe http://localhost:8000/api/readyz
   ```

10. The client's settings, as a ConfigMap. `API_UPSTREAM` is where nginx sends `/api`, and it overrides the `server:8000` default baked into the image. It has to be the full name, `server.podradar.svc.cluster.local:8000`: nginx looks the name up on every request with its own resolver, which ignores the pod's DNS search domains, so the short name `server` would not resolve.

    ```bash
    kubectl apply -f k8s/client-configmap.yaml
    ```

11. The client itself, as a Deployment with two replicas: it keeps no state, so any number of identical pods can serve it. It gets no Secret, since it never talks to MongoDB.

    ```bash
    kubectl apply -f k8s/client-deployment.yaml
    kubectl get pods -n podradar -w
    ```

12. A stable address for the client, as a ClusterIP Service. Its EndpointSlice lists both client pods.

    ```bash
    kubectl apply -f k8s/client-service.yaml
    kubectl get endpointslices -n podradar
    ```

    To open the app, keep a tunnel running and browse to http://localhost:8080:

    ```bash
    kubectl port-forward service/client 8080:8080 -n podradar
    ```

## Probes

MongoDB's readiness probe is a TCP check, not `mongosh`. An `exec` probe runs a process inside the container on every check; `mongosh` is a full Node.js program, the checks timed out and piled up, filled the container's 1Gi memory limit, and the pod was OOMKilled over and over. A health check runs all the time, so it has to be cheap: `httpGet` when the app has a health endpoint, `tcpSocket` when it does not.

A probe checks its own component only. The client's probes ask nginx for `/`, not `/api/...`: nginx forwards `/api` to the server, so a server or MongoDB outage would fail the client's probes too, restarting or hiding a client that works fine (a cascading failure). The client is built to show "Disconnected" in that case.

## Services

MongoDB's Service is headless (`clusterIP: None`): the name resolves straight to the pod, and each StatefulSet pod gets a DNS name of its own (`mongo-0.mongo.podradar.svc.cluster.local`), which a MongoDB replica set needs, since its members are not interchangeable. The server's and the client's Services are regular ClusterIPs: one virtual IP that never changes, and kube-proxy spreads the connections over the pods behind it, which are all the same. A Service finds its pods by label, and `targetPort` names the port as the pod names it (`http` in the server's Deployment).

## ConfigMaps

One ConfigMap per component rather than one for the whole app: MongoDB reads its ConfigMap as files, the server and client will read theirs as environment variables, and a change to one component's settings should restart only that component.

## Secrets

The MongoDB passwords are not in this folder on purpose. A Secret's values are only base64-encoded, not encrypted, so a Secret manifest with real values would put the passwords in git for anyone to decode.

Instead, the Secret is created from `.env`, which git ignores (copy `.env.example` to start). What the repository keeps is the recipe: the command above. To see the manifest that command would create, without sending anything to the cluster:

```bash
kubectl create secret generic mongo-credentials --from-env-file=.env -n podradar --dry-run=client -o yaml
```

The output contains the passwords in base64, so do not paste or commit it.

Later the command will be replaced by a Kustomize `secretGenerator`, which keeps in git only the fact that the Secret is built from `.env`.

For now there is one Secret for MongoDB's root and app users. The server takes only the two app keys, with `secretKeyRef`; `envFrom` with a `secretRef` would have handed it the root password too. It will be split into a root Secret and an app Secret together with the Kustomize and RBAC steps.
